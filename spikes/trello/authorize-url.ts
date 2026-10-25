// Prints the Trello authorize URL. Open it, approve, and the page shows a token.
import { need } from "../lib.js";

const key = need("TRELLO_API_KEY");
const url = new URL("https://trello.com/1/authorize");
url.search = new URLSearchParams({
  key,
  name: "TriageFox (spike)",
  scope: "read,write",
  expiration: "never",
  response_type: "token",
}).toString();
console.log("Open this, approve, then set TRELLO_TOKEN in .env:\n\n" + url + "\n");
