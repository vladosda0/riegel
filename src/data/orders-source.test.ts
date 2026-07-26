import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../backend-truth/generated/supabase-types";
import {
  createSupabaseOrdersSource,
  mergeOperationalRpcLinesOntoExistingOrderLines,
  shapeOrdersWithDetails,
} from "@/data/orders-source";

type TableName =
  | "orders"
  | "order_lines"
  | "inventory_movements"
  | "procurement_items"
  | "inventory_items";

type MockDatabase = {
  nextId: number;
  tables: {
    [K in TableName]: Array<Database["public"]["Tables"][K]["Row"]>;
  };
  /** When set, an `insert` into one of these tables rejects with the given error (failure injection). */
  failInsertOn?: Partial<Record<TableName, Error>>;
};

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; value: unknown[] };

function applyFilters<T extends Record<string, unknown>>(rows: T[], filters: Filter[]): T[] {
  return rows.filter((row) => filters.every((filter) => {
    if (filter.kind === "eq") {
      return row[filter.column] === filter.value;
    }
    return filter.value.includes(row[filter.column]);
  }));
}

function nextId(database: MockDatabase, prefix: string): string {
  database.nextId += 1;
  return `${prefix}-${database.nextId}`;
}

function hydrateInsertRow<TTable extends TableName>(
  database: MockDatabase,
  table: TTable,
  row: Record<string, unknown>,
): Database["public"]["Tables"][TTable]["Row"] {
  const timestamp = "2026-03-10T00:00:00.000Z";

  if (table === "orders") {
    return {
      id: typeof row.id === "string" ? row.id : nextId(database, "order"),
      project_id: String(row.project_id),
      supplier_name: String(row.supplier_name ?? ""),
      supplier_contact: (row.supplier_contact as string | null | undefined) ?? null,
      status: (row.status as Database["public"]["Tables"]["orders"]["Row"]["status"] | undefined) ?? "draft",
      ordered_at: (row.ordered_at as string | null | undefined) ?? null,
      delivery_due_at: (row.delivery_due_at as string | null | undefined) ?? null,
      created_by: String(row.created_by ?? "profile-1"),
      created_at: (row.created_at as string | undefined) ?? timestamp,
      updated_at: (row.updated_at as string | undefined) ?? timestamp,
    } as Database["public"]["Tables"][TTable]["Row"];
  }

  if (table === "order_lines") {
    return {
      id: typeof row.id === "string" ? row.id : nextId(database, "line"),
      order_id: String(row.order_id),
      procurement_item_id: (row.procurement_item_id as string | null | undefined) ?? null,
      title: String(row.title ?? ""),
      quantity: Number(row.quantity ?? 0),
      unit: (row.unit as string | null | undefined) ?? null,
      unit_price_cents: (row.unit_price_cents as number | null | undefined) ?? null,
      total_price_cents: (row.total_price_cents as number | null | undefined) ?? null,
      created_at: (row.created_at as string | undefined) ?? timestamp,
    } as Database["public"]["Tables"][TTable]["Row"];
  }

  if (table === "inventory_items") {
    return {
      id: typeof row.id === "string" ? row.id : nextId(database, "inventory-item"),
      project_id: String(row.project_id),
      title: String(row.title ?? ""),
      sku: (row.sku as string | null | undefined) ?? null,
      unit: String(row.unit ?? ""),
      notes: (row.notes as string | null | undefined) ?? null,
      created_at: (row.created_at as string | undefined) ?? timestamp,
      updated_at: (row.updated_at as string | undefined) ?? timestamp,
    } as Database["public"]["Tables"][TTable]["Row"];
  }

  if (table === "inventory_movements") {
    return {
      id: typeof row.id === "string" ? row.id : nextId(database, "movement"),
      project_id: String(row.project_id),
      inventory_item_id: String(row.inventory_item_id),
      inventory_location_id: (row.inventory_location_id as string | null | undefined) ?? null,
      order_line_id: (row.order_line_id as string | null | undefined) ?? null,
      procurement_item_id: (row.procurement_item_id as string | null | undefined) ?? null,
      movement_type: row.movement_type as Database["public"]["Tables"]["inventory_movements"]["Row"]["movement_type"],
      delta_qty: Number(row.delta_qty ?? 0),
      notes: (row.notes as string | null | undefined) ?? null,
      created_by: (row.created_by as string | null | undefined) ?? null,
      created_at: (row.created_at as string | undefined) ?? timestamp,
    } as Database["public"]["Tables"][TTable]["Row"];
  }

  return {
    id: typeof row.id === "string" ? row.id : nextId(database, "procurement-item"),
    project_id: String(row.project_id),
    estimate_resource_line_id: (row.estimate_resource_line_id as string | null | undefined) ?? null,
    task_id: (row.task_id as string | null | undefined) ?? null,
    title: String(row.title ?? ""),
    description: (row.description as string | null | undefined) ?? null,
    category: (row.category as string | null | undefined) ?? null,
    quantity: Number(row.quantity ?? 0),
    unit: (row.unit as string | null | undefined) ?? null,
    planned_unit_price_cents: (row.planned_unit_price_cents as number | null | undefined) ?? null,
    planned_total_price_cents: (row.planned_total_price_cents as number | null | undefined) ?? null,
    status: (row.status as Database["public"]["Tables"]["procurement_items"]["Row"]["status"] | undefined) ?? "requested",
    created_by: String(row.created_by ?? "profile-1"),
    created_at: (row.created_at as string | undefined) ?? timestamp,
    updated_at: (row.updated_at as string | undefined) ?? timestamp,
  } as Database["public"]["Tables"][TTable]["Row"];
}

class MockQueryBuilder<TTable extends TableName> implements PromiseLike<{ data: unknown; error: Error | null }> {
  private action: "select" | "insert" | "update" | "delete" | null = null;

  private filters: Filter[] = [];

  private payload: unknown = null;

  private orderConfig: { column: string; ascending: boolean } | null = null;

  private shouldReturnRows = false;

  private shouldReturnSingleRow = false;

  constructor(
    private readonly database: MockDatabase,
    private readonly table: TTable,
  ) {}

  select() {
    if (!this.action) {
      this.action = "select";
    }
    this.shouldReturnRows = true;
    return this;
  }

  insert(payload: unknown) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderConfig = {
      column,
      ascending: options?.ascending ?? true,
    };
    return this;
  }

  single() {
    this.shouldReturnSingleRow = true;
    return this;
  }

  then<TResult1 = { data: unknown; error: Error | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: Error | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: Error | null }> {
    const rows = this.database.tables[this.table] as Array<Record<string, unknown>>;

    if (this.action === "select") {
      const filteredRows = applyFilters(rows, this.filters);
      const orderedRows = this.orderConfig
        ? [...filteredRows].sort((left, right) => {
          const leftValue = left[this.orderConfig!.column];
          const rightValue = right[this.orderConfig!.column];
          if (leftValue === rightValue) return 0;
          if (leftValue == null) return this.orderConfig!.ascending ? -1 : 1;
          if (rightValue == null) return this.orderConfig!.ascending ? 1 : -1;
          const comparison = leftValue < rightValue ? -1 : 1;
          return this.orderConfig!.ascending ? comparison : comparison * -1;
        })
        : filteredRows;

      return {
        data: this.shouldReturnSingleRow ? (orderedRows[0] ?? null) : orderedRows,
        error: null,
      };
    }

    if (this.action === "insert") {
      const injectedError = this.database.failInsertOn?.[this.table];
      if (injectedError) {
        return { data: null, error: injectedError };
      }
      const nextRows = (Array.isArray(this.payload) ? this.payload : [this.payload])
        .map((row) => hydrateInsertRow(this.database, this.table, row as Record<string, unknown>));
      rows.push(...nextRows);
      return {
        data: this.shouldReturnRows
          ? (this.shouldReturnSingleRow ? (nextRows[0] ?? null) : nextRows)
          : null,
        error: null,
      };
    }

    if (this.action === "delete") {
      const doomed = applyFilters(rows, this.filters);
      const doomedIds = new Set(doomed.map((row) => row.id as string));
      this.database.tables[this.table] = (rows as Array<{ id: string }>)
        .filter((row) => !doomedIds.has(row.id)) as never;

      // Mirror the FK ON DELETE CASCADE: removing an order removes its lines, and
      // removing those lines removes their inventory movements.
      if (this.table === "orders") {
        const orderLines = this.database.tables.order_lines;
        const removedLineIds = new Set(
          orderLines.filter((line) => doomedIds.has(line.order_id)).map((line) => line.id),
        );
        this.database.tables.order_lines = orderLines.filter(
          (line) => !doomedIds.has(line.order_id),
        );
        this.database.tables.inventory_movements = this.database.tables.inventory_movements.filter(
          (movement) => !(movement.order_line_id && removedLineIds.has(movement.order_line_id)),
        );
      }

      return { data: null, error: null };
    }

    if (this.action === "update") {
      const timestamp = "2026-03-11T00:00:00.000Z";
      applyFilters(rows, this.filters).forEach((row) => {
        Object.assign(row, this.payload as Record<string, unknown>);
        if (this.table === "orders" && row.updated_at == null) {
          row.updated_at = timestamp;
        }
      });
    }

    return { data: null, error: null };
  }
}

function createMockSupabase(database: MockDatabase) {
  return {
    from<TTable extends TableName>(table: TTable) {
      return new MockQueryBuilder(database, table);
    },
  };
}

function procurementItemRow(
  overrides: Partial<Parameters<typeof shapeOrdersWithDetails>[0]["procurementItemRows"][number]> = {},
) {
  return {
    id: "proc-1",
    project_id: "project-1",
    estimate_resource_line_id: null,
    task_id: null,
    title: "Copper cable",
    description: "3x2.5",
    category: null,
    quantity: 12,
    unit: "m",
    planned_unit_price_cents: 1200,
    planned_total_price_cents: 14400,
    actual_unit_price_cents: null,
    notes: null,
    required_by_date: null,
    supplier_preferred: null,
    location_preferred_id: null,
    status: "ordered" as const,
    received_qty: 0,
    received_at: null,
    created_by: "profile-1",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-02T00:00:00.000Z",
    ...overrides,
  };
}

function orderRow(
  overrides: Partial<Parameters<typeof shapeOrdersWithDetails>[0]["orderRows"][number]> = {},
) {
  return {
    id: "order-stock",
    project_id: "project-1",
    supplier_name: "Warehouse",
    supplier_contact: null,
    status: "partially_received" as const,
    ordered_at: "2026-03-02T00:00:00.000Z",
    delivery_due_at: "2026-03-05T00:00:00.000Z",
    created_by: "profile-1",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-03T00:00:00.000Z",
    transfer_group_id: null,
    counterparty_project_id: null,
    counterparty_location_id: null,
    transfer_direction: null,
    transfer_payload: null,
    ...overrides,
  };
}

function lineRow(
  overrides: Partial<Parameters<typeof shapeOrdersWithDetails>[0]["lineRows"][number]> = {},
) {
  return {
    id: "line-stock",
    order_id: "order-stock",
    procurement_item_id: "proc-1",
    item_type: null,
    title: "Copper cable",
    quantity: 5,
    unit: "m",
    unit_price_cents: 1500,
    total_price_cents: 7500,
    created_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function movementRow(
  overrides: Partial<Parameters<typeof shapeOrdersWithDetails>[0]["movementRows"][number]> = {},
) {
  return {
    id: "movement-1",
    project_id: "project-1",
    inventory_item_id: "inventory-item-1",
    inventory_location_id: "location-a",
    order_line_id: "line-stock",
    procurement_item_id: "proc-1",
    movement_type: "transfer" as const,
    delta_qty: -2,
    notes: null,
    created_by: "profile-1",
    created_at: "2026-03-03T01:00:00.000Z",
    transfer_group_id: null,
    ...overrides,
  };
}

describe("orders-source helpers", () => {
  it("shapes orders, lines, and receive events with conservative compatibility rules", () => {
    const orders = shapeOrdersWithDetails({
      orderRows: [
        orderRow(),
        orderRow({
          id: "order-draft",
          status: "draft",
          supplier_name: "Draft Supplier",
          updated_at: "2026-03-02T00:00:00.000Z",
        }),
        orderRow({
          id: "order-void",
          status: "cancelled",
          supplier_name: "Cancelled Supplier",
          updated_at: "2026-03-01T12:00:00.000Z",
        }),
        orderRow({
          id: "order-supplier",
          status: "received",
          supplier_name: "BuildMart",
          updated_at: "2026-03-04T00:00:00.000Z",
        }),
      ],
      lineRows: [
        lineRow(),
        lineRow({
          id: "line-supplier",
          order_id: "order-supplier",
          procurement_item_id: "proc-2",
          title: "Drywall screws",
          quantity: 4,
          unit: null,
          unit_price_cents: 900,
        }),
      ],
      movementRows: [
        movementRow(),
        movementRow({
          id: "movement-2",
          inventory_location_id: "location-b",
          delta_qty: 2,
          created_at: "2026-03-03T01:00:00.000Z",
        }),
        movementRow({
          id: "movement-3",
          inventory_location_id: "location-b",
          movement_type: "issue",
          delta_qty: -1,
          created_at: "2026-03-03T02:00:00.000Z",
          notes: "Installed",
        }),
        movementRow({
          id: "movement-4",
          order_line_id: "line-supplier",
          procurement_item_id: "proc-2",
          inventory_location_id: "site",
          movement_type: "receipt",
          delta_qty: 4,
          created_at: "2026-03-04T01:00:00.000Z",
        }),
      ],
      procurementItemRows: [
        procurementItemRow(),
        procurementItemRow({
          id: "proc-2",
          title: "Drywall screws",
          unit: "pcs",
          planned_unit_price_cents: 800,
        }),
      ],
    });

    expect(orders).toHaveLength(4);

    const supplierOrder = orders.find((order) => order.id === "order-supplier");
    expect(supplierOrder).toEqual({
      id: "order-supplier",
      projectId: "project-1",
      status: "received",
      kind: "supplier",
      supplierName: "BuildMart",
      deliverToLocationId: "site",
      fromLocationId: null,
      toLocationId: null,
      dueDate: null,
      deliveryDeadline: "2026-03-05T00:00:00.000Z",
      invoiceAttachment: null,
      note: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-04T00:00:00.000Z",
      transferGroupId: null,
      transferDirection: null,
      counterpartyProjectId: null,
      counterpartyLocationId: null,
      lines: [
        {
          id: "line-supplier",
          orderId: "order-supplier",
          procurementItemId: "proc-2",
          title: "Drywall screws",
          itemType: null,
          qty: 4,
          receivedQty: 4,
          unit: "pcs",
          plannedUnitPrice: 8,
          actualUnitPrice: 9,
        },
      ],
      receiveEvents: [
        {
          id: "movement-4",
          orderId: "order-supplier",
          orderLineId: "line-supplier",
          procurementItemId: "proc-2",
          locationId: "site",
          deltaQty: 4,
          eventType: "receive",
          sourceLocationId: undefined,
          note: null,
          createdAt: "2026-03-04T01:00:00.000Z",
        },
      ],
    });

    const stockOrder = orders.find((order) => order.id === "order-stock");
    expect(stockOrder).toEqual({
      id: "order-stock",
      projectId: "project-1",
      // The row's 'partially_received' is preserved rather than flattened into 'placed'.
      status: "partially_received",
      kind: "stock",
      supplierName: "Warehouse",
      deliverToLocationId: "location-b",
      fromLocationId: "location-a",
      toLocationId: "location-b",
      dueDate: null,
      deliveryDeadline: "2026-03-05T00:00:00.000Z",
      invoiceAttachment: null,
      note: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-03T00:00:00.000Z",
      transferGroupId: null,
      transferDirection: null,
      counterpartyProjectId: null,
      counterpartyLocationId: null,
      lines: [
        {
          id: "line-stock",
          orderId: "order-stock",
          procurementItemId: "proc-1",
          title: "Copper cable",
          itemType: null,
          qty: 5,
          receivedQty: 2,
          unit: "m",
          plannedUnitPrice: 12,
          actualUnitPrice: 15,
        },
      ],
      receiveEvents: [
        {
          id: "movement-1",
          orderId: "order-stock",
          orderLineId: "line-stock",
          procurementItemId: "proc-1",
          locationId: "location-a",
          deltaQty: -2,
          eventType: "move_out",
          sourceLocationId: "location-b",
          note: null,
          createdAt: "2026-03-03T01:00:00.000Z",
        },
        {
          id: "movement-2",
          orderId: "order-stock",
          orderLineId: "line-stock",
          procurementItemId: "proc-1",
          locationId: "location-b",
          deltaQty: 2,
          eventType: "move_in",
          sourceLocationId: "location-a",
          note: null,
          createdAt: "2026-03-03T01:00:00.000Z",
        },
        {
          id: "movement-3",
          orderId: "order-stock",
          orderLineId: "line-stock",
          procurementItemId: "proc-1",
          locationId: "location-b",
          deltaQty: -1,
          eventType: "use",
          sourceLocationId: undefined,
          note: "Installed",
          createdAt: "2026-03-03T02:00:00.000Z",
        },
      ],
    });
  });
});

describe("supabase order writes", () => {
  let database: MockDatabase;

  beforeEach(() => {
    database = {
      nextId: 0,
      tables: {
        orders: [],
        order_lines: [],
        inventory_movements: [],
        procurement_items: [
          procurementItemRow({
            id: "proc-1",
            title: "Copper cable",
            description: "3x2.5",
            unit: "m",
          }),
          procurementItemRow({
            id: "proc-2",
            title: "Drywall screws",
            description: "Box",
            unit: "pcs",
          }),
        ],
        inventory_items: [
          {
            id: "inventory-item-existing",
            project_id: "project-1",
            title: "Copper cable",
            sku: null,
            unit: "m",
            notes: "3x2.5",
            identity_key: null,
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-02T00:00:00.000Z",
          },
        ],
      },
    };
  });

  it("creates draft supplier orders and persists order lines before placing them", async () => {
    const source = createSupabaseOrdersSource(
      createMockSupabase(database) as never,
      "profile-1",
    );

    const created = await source.createDraftSupplierOrder({
      projectId: "project-1",
      supplierName: "BuildMart",
      deliveryDeadline: "2026-03-20T00:00:00.000Z",
      lines: [
        {
          procurementItemId: "proc-1",
          title: "Copper cable",
          qty: 5,
          unit: "m",
          actualUnitPrice: 15,
        },
      ],
    });

    expect(database.tables.orders).toHaveLength(1);
    expect(database.tables.orders[0]).toMatchObject({
      project_id: "project-1",
      supplier_name: "BuildMart",
      status: "draft",
      created_by: "profile-1",
      delivery_due_at: "2026-03-20T00:00:00.000Z",
    });
    expect(database.tables.order_lines).toEqual([
      expect.objectContaining({
        procurement_item_id: "proc-1",
        title: "Copper cable",
        quantity: 5,
        unit: "m",
        unit_price_cents: 1500,
        total_price_cents: 7500,
      }),
    ]);
    expect(created.status).toBe("draft");

    const placed = await source.placeSupplierOrder(created.id);

    expect(database.tables.orders[0].status).toBe("placed");
    expect(database.tables.orders[0].ordered_at).toBeTruthy();
    expect(placed.status).toBe("placed");
  });

  it("receives supplier orders, reuses or creates inventory items, and updates partial/full status", async () => {
    database.tables.orders = [
      {
        id: "order-1",
        project_id: "project-1",
        supplier_name: "BuildMart",
        supplier_contact: null,
        status: "placed",
        ordered_at: "2026-03-10T00:00:00.000Z",
        delivery_due_at: "2026-03-20T00:00:00.000Z",
        created_by: "profile-1",
        created_at: "2026-03-10T00:00:00.000Z",
        updated_at: "2026-03-10T00:00:00.000Z",
        transfer_group_id: null,
        counterparty_project_id: null,
        counterparty_location_id: null,
        transfer_direction: null,
        transfer_payload: null,
      },
    ];
    database.tables.order_lines = [
      {
        id: "line-1",
        order_id: "order-1",
        procurement_item_id: "proc-1",
        item_type: null,
        title: "Copper cable",
        quantity: 5,
        unit: "m",
        unit_price_cents: 1500,
        total_price_cents: 7500,
        created_at: "2026-03-10T00:00:00.000Z",
      },
      {
        id: "line-2",
        order_id: "order-1",
        procurement_item_id: "proc-2",
        item_type: null,
        title: "Drywall screws",
        quantity: 5,
        unit: "pcs",
        unit_price_cents: 900,
        total_price_cents: 4500,
        created_at: "2026-03-10T00:00:00.000Z",
      },
    ];

    const source = createSupabaseOrdersSource(
      createMockSupabase(database) as never,
      "profile-1",
    );

    const partiallyReceived = await source.receiveSupplierOrder("order-1", {
      locationId: "location-site",
      lines: [
        { lineId: "line-1", qty: 5 },
        { lineId: "line-2", qty: 2 },
      ],
    });

    expect(database.tables.inventory_items).toHaveLength(2);
    expect(database.tables.inventory_items[1]).toMatchObject({
      project_id: "project-1",
      title: "Drywall screws",
      unit: "pcs",
      notes: "Box",
    });
    expect(database.tables.inventory_movements).toEqual([
      expect.objectContaining({
        inventory_item_id: "inventory-item-existing",
        order_line_id: "line-1",
        inventory_location_id: "location-site",
        delta_qty: 5,
      }),
      expect.objectContaining({
        inventory_item_id: database.tables.inventory_items[1].id,
        order_line_id: "line-2",
        inventory_location_id: "location-site",
        delta_qty: 2,
      }),
    ]);
    expect(database.tables.orders[0].status).toBe("partially_received");
    // The half-delivered state now survives the round trip back into the client model.
    expect(partiallyReceived.status).toBe("partially_received");
    expect(partiallyReceived.lines.find((line) => line.id === "line-1")?.receivedQty).toBe(5);
    expect(partiallyReceived.lines.find((line) => line.id === "line-2")?.receivedQty).toBe(2);

    const fullyReceived = await source.receiveSupplierOrder("order-1", {
      locationId: "location-site",
      lines: [{ lineId: "line-2", qty: 3 }],
    });

    expect(database.tables.orders[0].status).toBe("received");
    expect(database.tables.inventory_movements).toHaveLength(3);
    expect(fullyReceived.status).toBe("received");
    expect(fullyReceived.lines.find((line) => line.id === "line-2")?.receivedQty).toBe(5);
  });
});

describe("supabase stock transfers", () => {
  let database: MockDatabase;

  beforeEach(() => {
    database = {
      nextId: 0,
      tables: {
        orders: [],
        order_lines: [],
        inventory_movements: [],
        procurement_items: [
          procurementItemRow({
            id: "proc-1",
            title: "Copper cable",
            description: "3x2.5",
            unit: "m",
          }),
          procurementItemRow({
            id: "proc-2",
            title: "Drywall screws",
            description: "Box",
            unit: "pcs",
          }),
        ],
        inventory_items: [
          {
            id: "inventory-item-existing",
            project_id: "project-1",
            title: "Copper cable",
            sku: null,
            unit: "m",
            notes: "3x2.5",
            identity_key: null,
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-02T00:00:00.000Z",
          },
        ],
      },
    };
  });

  it("writes a received order, paired transfer movements, and reuses/creates inventory items", async () => {
    const source = createSupabaseOrdersSource(
      createMockSupabase(database) as never,
      "profile-1",
    );

    const created = await source.placeStockTransfer({
      projectId: "project-1",
      fromLocationId: "location-a",
      toLocationId: "location-b",
      deliveryDeadline: "2026-03-20T00:00:00.000Z",
      lines: [
        {
          procurementItemId: "proc-1",
          title: "Copper cable",
          qty: 3,
          unit: "m",
          spec: "3x2.5",
        },
        {
          procurementItemId: "proc-2",
          title: "Drywall screws",
          qty: 4,
          unit: "pcs",
          spec: "Box",
        },
      ],
    });

    expect(database.tables.orders).toHaveLength(1);
    expect(database.tables.orders[0]).toMatchObject({
      project_id: "project-1",
      supplier_name: "",
      status: "received",
      created_by: "profile-1",
      delivery_due_at: "2026-03-20T00:00:00.000Z",
    });
    expect(database.tables.orders[0].ordered_at).toBeTruthy();
    expect(database.tables.order_lines).toHaveLength(2);

    // The "Copper cable" line reuses the existing inventory item; "Drywall screws" creates one.
    expect(database.tables.inventory_items).toHaveLength(2);
    const createdInventoryItem = database.tables.inventory_items[1];
    expect(createdInventoryItem).toMatchObject({
      project_id: "project-1",
      title: "Drywall screws",
      unit: "pcs",
      notes: "Box",
    });

    const copperLineId = database.tables.order_lines.find((line) => line.procurement_item_id === "proc-1")?.id;
    const screwLineId = database.tables.order_lines.find((line) => line.procurement_item_id === "proc-2")?.id;

    // Two paired movements per line: -qty at the source, +qty at the destination.
    expect(database.tables.inventory_movements).toHaveLength(4);
    const copperMovements = database.tables.inventory_movements.filter(
      (movement) => movement.order_line_id === copperLineId,
    );
    expect(copperMovements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventory_item_id: "inventory-item-existing",
          inventory_location_id: "location-a",
          movement_type: "transfer",
          delta_qty: -3,
          procurement_item_id: "proc-1",
          created_by: "profile-1",
        }),
        expect.objectContaining({
          inventory_item_id: "inventory-item-existing",
          inventory_location_id: "location-b",
          movement_type: "transfer",
          delta_qty: 3,
          procurement_item_id: "proc-1",
          created_by: "profile-1",
        }),
      ]),
    );

    const screwMovements = database.tables.inventory_movements.filter(
      (movement) => movement.order_line_id === screwLineId,
    );
    expect(screwMovements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventory_item_id: createdInventoryItem.id,
          inventory_location_id: "location-a",
          movement_type: "transfer",
          delta_qty: -4,
        }),
        expect.objectContaining({
          inventory_item_id: createdInventoryItem.id,
          inventory_location_id: "location-b",
          movement_type: "transfer",
          delta_qty: 4,
        }),
      ]),
    );

    expect(created.kind).toBe("stock");
    expect(created.status).toBe("received");
    expect(created.fromLocationId).toBe("location-a");
    expect(created.toLocationId).toBe("location-b");
  });

  it("rejects same source/destination warehouse without writing anything", async () => {
    const source = createSupabaseOrdersSource(
      createMockSupabase(database) as never,
      "profile-1",
    );

    await expect(
      source.placeStockTransfer({
        projectId: "project-1",
        fromLocationId: "location-a",
        toLocationId: "location-a",
        lines: [{ procurementItemId: "proc-1", title: "Copper cable", qty: 3, unit: "m", spec: "3x2.5" }],
      }),
    ).rejects.toThrow();

    expect(database.tables.orders).toHaveLength(0);
    expect(database.tables.order_lines).toHaveLength(0);
    expect(database.tables.inventory_movements).toHaveLength(0);
  });

  it("deletes the orphan order when the movement insert fails (no ghost received order)", async () => {
    database.failInsertOn = { inventory_movements: new Error("inventory_balances negative") };
    const source = createSupabaseOrdersSource(
      createMockSupabase(database) as never,
      "profile-1",
    );

    await expect(
      source.placeStockTransfer({
        projectId: "project-1",
        fromLocationId: "location-a",
        toLocationId: "location-b",
        lines: [{ procurementItemId: "proc-1", title: "Copper cable", qty: 99, unit: "m", spec: "3x2.5" }],
      }),
    ).rejects.toThrow("inventory_balances negative");

    // Orphan cleanup ran: the order row (and its cascaded lines) are gone, no movements landed.
    expect(database.tables.orders).toHaveLength(0);
    expect(database.tables.order_lines).toHaveLength(0);
    expect(database.tables.inventory_movements).toHaveLength(0);
  });
});

describe("mergeOperationalRpcLinesOntoExistingOrderLines", () => {
  it("preserves receivedQty from DB-shaped lines when applying operational RPC rows", () => {
    const procItemTypeById = new Map<string, string | null>([["pi-1", "material"]]);
    const existing = [{
      id: "ol-1",
      orderId: "ord-1",
      procurementItemId: "pi-1",
      qty: 10,
      receivedQty: 7,
      unit: "m",
      plannedUnitPrice: 1,
      actualUnitPrice: 1,
    }];
    const rpc = [{
      order_line_id: "ol-1",
      order_id: "ord-1",
      order_status: "placed",
      ordered_at: null,
      delivery_due_at: null,
      procurement_item_id: "pi-1",
      procurement_item_title: "Cable",
      estimate_resource_line_id: null,
      estimate_resource_line_resource_type: null,
      title: "Cable",
      quantity: 10,
      unit: "m",
      created_at: "2026-01-01T00:00:00.000Z",
    }];
    const merged = mergeOperationalRpcLinesOntoExistingOrderLines(existing, rpc, procItemTypeById);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.receivedQty).toBe(7);
    expect(merged[0]?.plannedUnitPrice).toBeNull();
    expect(merged[0]?.itemType).toBe("material");
  });

  it("uses estimate_resource_line_resource_type on RPC ordered line when procurement_items map misses", () => {
    const procItemTypeById = new Map<string, string | null>();
    const existing = [{
      id: "ol-1",
      orderId: "ord-1",
      procurementItemId: "pi-tool",
      qty: 2,
      receivedQty: 2,
      unit: "pcs",
      plannedUnitPrice: null,
      actualUnitPrice: null,
    }];
    const rpc = [{
      order_line_id: "ol-1",
      order_id: "ord-1",
      order_status: "placed",
      ordered_at: null,
      delivery_due_at: null,
      procurement_item_id: "pi-tool",
      procurement_item_title: "Hammer",
      estimate_resource_line_id: "erl-1",
      estimate_resource_line_resource_type: "tool",
      title: "Hammer",
      quantity: 2,
      unit: "pcs",
      created_at: "2026-01-01T00:00:00.000Z",
    }];
    const merged = mergeOperationalRpcLinesOntoExistingOrderLines(existing, rpc, procItemTypeById);
    expect(merged[0]?.itemType).toBe("tool");
    expect(merged[0]?.receivedQty).toBe(2);
  });
});

describe("order row status mapping", () => {
  // Enumerated over the full DB status domain. Collapsing 'partially_received' into 'placed'
  // here is what previously made the state unreachable in the client model, so every
  // «Частично получено» label and every partially-received branch downstream was dead code.
  it.each([
    ["draft", "draft"],
    ["placed", "placed"],
    ["partially_received", "partially_received"],
    ["received", "received"],
    ["cancelled", "voided"],
  ] as const)("maps the %s row status to %s", (rowStatus, expected) => {
    const [shaped] = shapeOrdersWithDetails({
      orderRows: [orderRow({ id: "order-x", status: rowStatus })],
      lineRows: [],
      movementRows: [],
      procurementItemRows: [],
    });

    expect(shaped.status).toBe(expected);
  });

  it("falls back to placed for an unrecognised row status", () => {
    const [shaped] = shapeOrdersWithDetails({
      orderRows: [orderRow({ id: "order-x", status: "some_future_state" as never })],
      lineRows: [],
      movementRows: [],
      procurementItemRows: [],
    });

    expect(shaped.status).toBe("placed");
  });
});
