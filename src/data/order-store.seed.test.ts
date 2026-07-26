import { describe, expect, it } from "vitest";
import { listOrdersByProject } from "@/data/order-store";

// Deliberately in its own file: the demo orders are seeded once at module load, and the
// other order-store tests call __unsafeResetOrdersForTests(), which wipes the seed without
// re-running it. Vitest gives each test file a fresh module instance, so this one observes
// the seed as the demo workspace actually presents it.
describe("demo order seed", () => {
  it("seeds a part-delivered procurement item as partially_received", () => {
    // proc-3-2 «Щебень дренажный фр. 20–40»: orderedQty 8, receivedQty 5, note
    // «Ожидается поставка ещё 3 м³» — the demo's canonical half-delivered item. It must not
    // read «Заказано» next to a runtime partial receipt that reads «Частично получено».
    const order = listOrdersByProject("project-3").find((entry) => entry.id === "order-seed-proc-3-2");

    expect(order).toBeDefined();
    expect(order?.status).toBe("partially_received");
    expect(order?.lines[0]?.qty).toBe(8);
    expect(order?.lines[0]?.receivedQty).toBe(5);
  });

  it("still seeds fully and un-received items as received and placed", () => {
    const orders = listOrdersByProject("project-3");
    const statuses = new Set(orders.map((entry) => entry.status));

    // Whatever else the seed contains, nothing may land on draft or voided.
    expect([...statuses].every((s) => s === "placed" || s === "partially_received" || s === "received")).toBe(true);
  });
});
