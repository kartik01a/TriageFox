#!/usr/bin/env bash
# Keeps asking Oracle Cloud for an Always Free ARM server (VM.Standard.A1.Flex) until one is free,
# then prints its public IP. Oracle often answers "Out of capacity" for this shape; servers come back
# at random times, so a slow, steady retry is the usual way to get one.
#
# Needs: the OCI CLI (`brew install oci-cli`) set up with `oci setup config`, and a VCN made with
# Oracle's "VCN with Internet Connectivity" wizard (its public subnet is found by name).
#
# Run (keeps the Mac awake while it waits):
#   caffeinate -i ./deploy/oracle-a1-retry.sh
# Optional settings: OCPUS (1), MEMORY_GB (6), BOOT_GB (100), INTERVAL (60 seconds),
#   NAME (triagefox), SUBNET_NAME ("public subnet-triagefox-vcn"), SSH_KEY (~/.ssh/id_ed25519.pub)
set -euo pipefail

OCPUS="${OCPUS:-1}"
MEMORY_GB="${MEMORY_GB:-6}"
BOOT_GB="${BOOT_GB:-100}"
INTERVAL="${INTERVAL:-60}"
NAME="${NAME:-triagefox}"
SUBNET_NAME="${SUBNET_NAME:-public subnet-triagefox-vcn}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519.pub}"
SHAPE="VM.Standard.A1.Flex"

say() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { say "ERROR: $*"; exit 1; }
notify() { osascript -e "display notification \"$1\" with title \"Oracle server\"" >/dev/null 2>&1 || true; }

command -v oci >/dev/null || fail "the OCI CLI is not installed (brew install oci-cli)."
[[ -f "$HOME/.oci/config" ]] || fail "run 'oci setup config' first."
[[ -f "$SSH_KEY" ]] || fail "no SSH public key at $SSH_KEY."

# The tenancy (root compartment) id comes from the CLI's own config file.
TENANCY="$(awk -F= '/^\[DEFAULT\]/{d=1;next} /^\[/{d=0} d && $1~/^tenancy/{gsub(/[ \t]/,"",$2); print $2; exit}' "$HOME/.oci/config")"
[[ -n "$TENANCY" ]] || fail "could not read 'tenancy' from ~/.oci/config."

say "Looking up the availability domain, subnet and Ubuntu image..."
AD="$(oci iam availability-domain list --compartment-id "$TENANCY" --query 'data[0].name' --raw-output)" \
  || fail "the CLI could not sign in. Check ~/.oci/config and that the API key is added in Oracle (My profile -> API keys)."
SUBNET="$(oci network subnet list --compartment-id "$TENANCY" --display-name "$SUBNET_NAME" --query 'data[0].id' --raw-output)"
[[ -n "$SUBNET" && "$SUBNET" != "null" ]] || fail "no subnet named '$SUBNET_NAME' (create the VCN with the wizard first)."
IMAGE="$(oci compute image list --compartment-id "$TENANCY" --operating-system "Canonical Ubuntu" \
  --operating-system-version "24.04" --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --limit 1 --query 'data[0].id' --raw-output)"
[[ -n "$IMAGE" && "$IMAGE" != "null" ]] || fail "no Ubuntu 24.04 image found for $SHAPE."
IMAGE_NAME="$(oci compute image get --image-id "$IMAGE" --query 'data."display-name"' --raw-output)"

say "Region domain: $AD"
say "Image:         $IMAGE_NAME"
say "Server:        $SHAPE, $OCPUS OCPU, $MEMORY_GB GB memory, $BOOT_GB GB disk, name '$NAME'"

existing() {
  oci compute instance list --compartment-id "$TENANCY" --display-name "$NAME" --all \
    --query "data[?\"lifecycle-state\"!='TERMINATED' && \"lifecycle-state\"!='TERMINATING'] | [0].id" --raw-output 2>/dev/null || true
}

report() {
  local id="$1" ip
  say "Waiting for the server to start..."
  oci compute instance get --instance-id "$id" --wait-for-state RUNNING --max-wait-seconds 900 >/dev/null || true
  ip="$(oci compute instance list-vnics --instance-id "$id" --query 'data[0]."public-ip"' --raw-output 2>/dev/null || true)"
  say "Done. Public IP: ${ip:-unknown (see the Oracle console)}"
  say "Next: make this IP reserved in the console, then: ssh ubuntu@${ip:-<IP>}"
  notify "Your server is ready: ${ip:-see console}"
}

id="$(existing)"
if [[ -n "$id" && "$id" != "null" ]]; then
  say "A server named '$NAME' already exists, nothing to create."
  report "$id"
  exit 0
fi

attempt=0
while true; do
  attempt=$((attempt + 1))
  set +e
  out="$(oci compute instance launch \
    --availability-domain "$AD" \
    --compartment-id "$TENANCY" \
    --display-name "$NAME" \
    --shape "$SHAPE" \
    --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY_GB}" \
    --image-id "$IMAGE" \
    --boot-volume-size-in-gbs "$BOOT_GB" \
    --subnet-id "$SUBNET" \
    --assign-public-ip true \
    --ssh-authorized-keys-file "$SSH_KEY" \
    --query 'data.id' --raw-output 2>&1)"
  code=$?
  set -e

  if [[ $code -eq 0 && "$out" == ocid1.instance.* ]]; then
    say "Attempt $attempt: got a server!"
    report "$out"
    exit 0
  fi

  if grep -qiE 'out of (host )?capacity' <<<"$out"; then
    say "Attempt $attempt: out of capacity. Trying again in ${INTERVAL}s."
    sleep "$INTERVAL"
  elif grep -qiE 'TooManyRequests|429|timed out|timeout|Connection|ServiceUnavailable|InternalServerError' <<<"$out"; then
    say "Attempt $attempt: Oracle is busy or the network blinked. Trying again in $((INTERVAL * 2))s."
    sleep $((INTERVAL * 2))
  else
    say "Attempt $attempt: Oracle refused for another reason, stopping so you can read it:"
    printf '%s\n' "$out"
    notify "The retry script stopped: see the terminal"
    exit 1
  fi
done
