import { JsonStateStore } from "./core/json-state.store.js";

async function main() {
  const store = new JsonStateStore();
  await store.reset();
  await store.close();
  console.log("Seeded cjlass2 state");
}

void main();
