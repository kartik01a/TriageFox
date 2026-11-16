#!/usr/bin/env bash
# Lets ports 80 and 443 on the Oracle server accept connections only from Cloudflare, so nobody can reach
# the app without going through Cloudflare (and so cannot fake the CF-Connecting-IP header the app trusts
# for rate limiting). Every other rule (SSH, ping) is kept exactly as it is.
#
# Run from your own computer (needs the OCI CLI and jq). Dry run by default:
#   ./deploy/oracle-cloudflare-only.sh            show what would change
#   ./deploy/oracle-cloudflare-only.sh --apply    change the security list
# Run it again whenever Cloudflare changes its address list (rare: https://www.cloudflare.com/ips/).
# Afterwards the DNS records must stay proxied (orange cloud); "DNS only" would make the site unreachable.
# Optional: SUBNET_NAME ("public subnet-triagefox-vcn").
set -euo pipefail

SUBNET_NAME="${SUBNET_NAME:-public subnet-triagefox-vcn}"
TAG="Cloudflare only (oracle-cloudflare-only.sh)"
apply=false
[[ "${1:-}" == "--apply" ]] && apply=true

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v oci >/dev/null || fail "the OCI CLI is not installed (brew install oci-cli)."
command -v jq >/dev/null || fail "jq is not installed (brew install jq)."

TENANCY="$(awk -F= '/^\[DEFAULT\]/{d=1;next} /^\[/{d=0} d && $1~/^tenancy/{gsub(/[ \t]/,"",$2); print $2; exit}' "$HOME/.oci/config")"
[[ -n "$TENANCY" ]] || fail "could not read 'tenancy' from ~/.oci/config."

# Cloudflare's own list. Refuse to continue on anything odd: a bad list would take the site offline.
ranges="$(curl -fsS -m 20 https://api.cloudflare.com/client/v4/ips | jq -r 'select(.success) | .result.ipv4_cidrs[]')" \
  || fail "could not fetch Cloudflare's address list."
count="$(grep -c . <<<"$ranges" || true)"
[[ "$count" -ge 10 ]] || fail "Cloudflare's list has only $count ranges; not touching the firewall."
grep -qvE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$' <<<"$ranges" && fail "unexpected entry in Cloudflare's list."

SL="$(oci network subnet list --compartment-id "$TENANCY" --display-name "$SUBNET_NAME" \
  --query 'data[0]."security-list-ids"[0]' --raw-output)" || fail "could not read the subnet."
[[ "$SL" == ocid1.securitylist.* ]] || fail "no security list found for subnet '$SUBNET_NAME'."

current="$(oci network security-list get --security-list-id "$SL" --query 'data."ingress-security-rules"')"

# The CLI prints kebab-case keys but takes camelCase ones back.
camel='def camel: if type=="object" then with_entries(.key |= gsub("-(?<c>[a-z])"; .c|ascii_upcase) | .value |= camel)
  elif type=="array" then map(camel) else . end;'
web='(.protocol=="6" and (.["tcp-options"]["destination-port-range"].min // 0) as $p | ($p==80 or $p==443))'

kept="$(jq "$camel [.[] | select(($web) | not)] | camel" <<<"$current")"
added="$(jq -R -s --arg tag "$TAG" '[split("\n")[] | select(length>0) as $r | (80, 443) as $p |
  {source:$r, sourceType:"CIDR_BLOCK", protocol:"6", isStateless:false, description:$tag,
   tcpOptions:{destinationPortRange:{min:$p, max:$p}}}]' <<<"$ranges")"
rules="$(jq -s '.[0] + .[1]' <(echo "$kept") <(echo "$added"))"

echo "Security list: $SL"
echo "Now open on 80/443 to:"
jq -r ".[] | select($web) | \"  \(.source) port \(.[\"tcp-options\"][\"destination-port-range\"].min)\"" <<<"$current"
echo "Rules kept unchanged: $(jq length <<<"$kept")"
jq -r '.[] | "  \(.protocol) from \(.source) \(.tcpOptions.destinationPortRange // "" | if .=="" then "" else "port \(.min)" end)"' <<<"$kept"
echo "After: ports 80 and 443 open only to Cloudflare's $count ranges ($(jq length <<<"$added") rules)."

if ! $apply; then
  echo; echo "Dry run: nothing changed. Run again with --apply."
  exit 0
fi
# Never apply a list that loses SSH.
jq -e 'any(.[]; .protocol=="6" and .tcpOptions.destinationPortRange.min==22)' <<<"$rules" >/dev/null \
  || fail "the new rules would have no SSH rule; refusing."
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
echo "$rules" >"$tmp"
oci network security-list update --security-list-id "$SL" --ingress-security-rules "file://$tmp" --force >/dev/null
echo "Done. Ports 80 and 443 now accept only Cloudflare."
