// Q: authorize flow, create card + labels + due date, attachment upload and its size limit,
//    and whether dateLastActivity changes when a human edits (our "human edited?" check).
import { need, capture, http } from "../lib.js";

const key = need("TRELLO_API_KEY"), token = need("TRELLO_TOKEN");
const q = (extra: Record<string, string> = {}) => new URLSearchParams({ key, token, ...extra });
const api = (p: string, extra?: Record<string, string>, init?: RequestInit) =>
  http(`https://api.trello.com/1${p}?${q(extra)}`, init);

const boards = await api("/members/me/boards", { fields: "name,url" });
console.log("boards:", boards.status);
(boards.body as any[]).forEach((b) => console.log(`  ${b.id}  ${b.name}`));
const boardId = process.env.TRELLO_BOARD_ID;
if (!boardId) { console.log("\nSet TRELLO_BOARD_ID (a test board) and rerun."); process.exit(0); }

// safety: never write to a board unless it is clearly a test board
const board = (await api(`/boards/${boardId}`, { fields: "name,closed" })).body as any;
console.log(`board: "${board.name}" closed=${board.closed}`);
if (board.closed || !/test|triagefox/i.test(board.name)) {
  console.error('Refusing to write: the board must be open and its name must contain "test" or "triagefox".');
  process.exit(1);
}
const lists = await api(`/boards/${boardId}/lists`, { fields: "name" });
(lists.body as any[]).forEach((l) => console.log(`  list ${l.id}  ${l.name}`));
const listId = process.env.TRELLO_LIST_ID;
if (!listId) { console.log("\nSet TRELLO_LIST_ID and rerun."); process.exit(0); }

// labels: create a priority + type label (colours from docs/integrations/trello.md)
const p4 = await api(`/boards/${boardId}/labels`, { name: "P4 High", color: "orange" }, { method: "POST" });
const bug = await api(`/boards/${boardId}/labels`, { name: "Bug", color: "blue" }, { method: "POST" });
console.log("labels created:", p4.status, bug.status);

const due = new Date(Date.now() + 3 * 864e5).toISOString();
const card = await api("/cards", {
  idList: listId, name: "[spike] Checkout button does nothing on Safari",
  desc: "## Summary\nSpike card.\n\n**Expected:** works\n**Actual:** nothing happens",
  due, idLabels: [(p4.body as any).id, (bug.body as any).id].join(","),
}, { method: "POST" });
console.log("card:", card.status, (card.body as any).shortUrl);
capture("trello-card-created", card.body);
const cardId = (card.body as any).id;

// attachment upload: small file, then a big one to find the limit
for (const mb of [1, 10, 26]) {
  const form = new FormData();
  form.set("key", key); form.set("token", token);
  form.set("file", new Blob([new Uint8Array(mb * 1024 * 1024)]), `spike-${mb}mb.bin`);
  const r = await http(`https://api.trello.com/1/cards/${cardId}/attachments`, { method: "POST", body: form });
  console.log(`attachment ${mb}MB:`, r.status, r.status === 200 ? "ok" : JSON.stringify(r.body).slice(0, 120));
}

const before = await api(`/cards/${cardId}`, { fields: "dateLastActivity,desc" });
await api(`/cards/${cardId}/actions/comments`, { text: "spike comment (as the API user)" }, { method: "POST" });
const afterComment = await api(`/cards/${cardId}`, { fields: "dateLastActivity" });
console.log("dateLastActivity before:", (before.body as any).dateLastActivity);
console.log("after comment          :", (afterComment.body as any).dateLastActivity,
  "\n  -> a comment bumps it, so compare the DESCRIPTION edit time via actions instead:");
const actions = await api(`/cards/${cardId}/actions`, { filter: "updateCard:desc,commentCard,createCard" });
capture("trello-card-actions", actions.body);
console.log("  now edit the card description by hand in Trello, rerun with TRELLO_CARD_ID to confirm an updateCard:desc action appears.");
console.log("cleanup: card", cardId, "(delete by hand when done)");
