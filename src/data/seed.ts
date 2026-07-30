import type {
  User, Project, Member, Stage, Task, Estimate, ProcurementItem,
  Document, Media, Event, Notification,
} from "@/types/entities";
import type { Database as WorkspaceDatabase } from "../../backend-truth/generated/supabase-types";

type WorkspaceProjectInvite = WorkspaceDatabase["public"]["Tables"]["project_invites"]["Row"];

export const seedUser: User = {
  id: "user-1",
  email: "alex@rovno.ai",
  name: "Алексей Петров",
  locale: "ru",
  timezone: "Europe/Moscow",
  plan: "pro",
  credits_free: 50,
  credits_paid: 200,
};

const otherUsers: User[] = [
  { id: "user-2", email: "maria@example.com", name: "Мария Иванова", locale: "ru", timezone: "Europe/Moscow", plan: "free", credits_free: 50, credits_paid: 0 },
  { id: "user-3", email: "dmitry@example.com", name: "Дмитрий Соколов", locale: "ru", timezone: "Europe/Moscow", plan: "free", credits_free: 50, credits_paid: 0 },
];

export const seedProjects: Project[] = [
  {
    id: "project-1",
    owner_id: "user-1",
    title: "Ремонт квартиры",
    type: "residential",
    automation_level: "full",
    current_stage_id: "stage-1-2",
    progress_pct: 45,
    address: "Невский проспект, 12, кв. 8, Санкт-Петербург",
    ai_description: "Демонтаж завершён. Идут черновые работы по электрике и сантехнике, чистовая отделка в очереди после завершения сантехнических работ.",
  },
  {
    id: "project-2",
    owner_id: "user-1",
    title: "Отделка офиса",
    type: "commercial",
    automation_level: "assisted",
    current_stage_id: "stage-2-1",
    progress_pct: 15,
    address: "Бизнес-центр «Неглинка», Неглинная ул., 5, офис 210, Москва",
    ai_description: "Идёт планировка пространства. Строительно-монтажные задачи подготовлены и готовы к назначению.",
  },
  {
    id: "project-3",
    owner_id: "user-1",
    title: "Благоустройство участка",
    type: "residential",
    automation_level: "full",
    current_stage_id: "stage-3-3",
    progress_pct: 65,
    address: "СНТ «Берёзовая роща», участок 42, Московская область",
    ai_description: "Дренаж и выравнивание готовы. Идёт укладка брусчатки, поставка декоративного гравия задерживается.",
  },
];

export const seedMembers: Member[] = [
  { project_id: "project-1", user_id: "user-1", role: "owner", ai_access: "project_pool", credit_limit: 500, used_credits: 45 },
  { project_id: "project-1", user_id: "user-2", role: "contractor", ai_access: "consult_only", credit_limit: 100, used_credits: 12 },
  { project_id: "project-1", user_id: "user-3", role: "viewer", ai_access: "none", credit_limit: 0, used_credits: 0 },
  { project_id: "project-2", user_id: "user-1", role: "owner", ai_access: "project_pool", credit_limit: 500, used_credits: 8 },
  { project_id: "project-2", user_id: "user-2", role: "contractor", ai_access: "consult_only", credit_limit: 50, used_credits: 3 },
  { project_id: "project-3", user_id: "user-1", role: "owner", ai_access: "project_pool", credit_limit: 500, used_credits: 120 },
  { project_id: "project-3", user_id: "user-2", role: "contractor", ai_access: "consult_only", credit_limit: 100, used_credits: 25 },
  { project_id: "project-3", user_id: "user-3", role: "viewer", ai_access: "consult_only", credit_limit: 30, used_credits: 10 },
];

export const seedStages: Stage[] = [
  // Project 1
  { id: "stage-1-1", project_id: "project-1", title: "Снос и демонтаж", description: "Снятие старых покрытий и демонтаж конструкций", order: 1, status: "completed" },
  { id: "stage-1-2", project_id: "project-1", title: "Электрика и сантехника", description: "Черновая разводка электрики и трубопроводов", order: 2, status: "open" },
  { id: "stage-1-3", project_id: "project-1", title: "Чистовая отделка", description: "Гипсокартон, покраска, плитка, напольные покрытия", order: 3, status: "open" },
  // Project 2
  { id: "stage-2-1", project_id: "project-2", title: "Планировка пространства", description: "Разработка планировки и зонирование офиса", order: 1, status: "open" },
  { id: "stage-2-2", project_id: "project-2", title: "Строительство", description: "Монтаж перегородок и инженерных систем", order: 2, status: "open" },
  // Project 3
  { id: "stage-3-1", project_id: "project-3", title: "Подготовка участка", description: "Расчистка территории и вывоз мусора", order: 1, status: "completed" },
  { id: "stage-3-2", project_id: "project-3", title: "Дренаж и выравнивание", description: "Монтаж дренажа и планировка грунта", order: 2, status: "completed" },
  { id: "stage-3-3", project_id: "project-3", title: "Укладка мощения", description: "Устройство основания и укладка брусчатки", order: 3, status: "open" },
  { id: "stage-3-4", project_id: "project-3", title: "Озеленение и финиш", description: "Посадки, декоративный гравий, финишные работы", order: 4, status: "open" },
];

export const seedTasks: Task[] = [
  // Project 1 tasks
  { id: "task-1-1", project_id: "project-1", stage_id: "stage-1-1", title: "Снятие старых покрытий", description: "Снять ламинат и подложку во всех комнатах", status: "done", assignee_id: "user-2", checklist: [{ id: "cl-1", text: "Гостиная", done: true }, { id: "cl-2", text: "Спальня", done: true }], comments: [{ id: "com-1", author_id: "user-2", text: "Закончили с опережением графика", created_at: "2025-01-15T10:00:00Z" }], attachments: [], photos: [], linked_estimate_item_ids: ["ei-1-1"], created_at: "2025-01-10T09:00:00Z" },
  { id: "task-1-2", project_id: "project-1", stage_id: "stage-1-1", title: "Демонтаж плитки в ванной", description: "Аккуратно снять плитку, сохранить сантехнические выводы", status: "done", assignee_id: "user-2", checklist: [], comments: [], attachments: [], photos: [], linked_estimate_item_ids: ["ei-1-2"], created_at: "2025-01-10T09:30:00Z" },
  { id: "task-1-3", project_id: "project-1", stage_id: "stage-1-2", title: "Черновая электрика", description: "Прокладка кабелей на кухню и в санузел", status: "in_progress", assignee_id: "user-2", checklist: [{ id: "cl-3", text: "Кухонная группа", done: true }, { id: "cl-4", text: "Санузел", done: false }], comments: [], attachments: [], photos: [], linked_estimate_item_ids: ["ei-1-3"], created_at: "2025-01-20T10:00:00Z", deadline: "2025-03-15T00:00:00Z" },
  { id: "task-1-4", project_id: "project-1", stage_id: "stage-1-2", title: "Черновая сантехника", description: "Монтаж труб водоснабжения и канализации", status: "not_started", assignee_id: "user-2", checklist: [], comments: [], attachments: [], photos: [], linked_estimate_item_ids: ["ei-1-4"], created_at: "2025-01-20T10:30:00Z", deadline: "2025-04-01T00:00:00Z" },
  { id: "task-1-5", project_id: "project-1", stage_id: "stage-1-3", title: "Монтаж гипсокартона", description: "Установка и шпаклёвка гипсокартонных конструкций во всех комнатах", status: "not_started", assignee_id: "user-3", checklist: [], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-25T08:00:00Z" },
  { id: "task-1-6", project_id: "project-1", stage_id: "stage-1-3", title: "Укладка плитки — ванная", description: "Укладка напольной и настенной плитки в санузле", status: "blocked", assignee_id: "user-2", checklist: [], comments: [{ id: "com-2", author_id: "user-2", text: "Ждём завершения черновой сантехники", created_at: "2025-02-10T14:30:00Z" }], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-25T08:30:00Z" },
  // Project 2 tasks
  { id: "task-2-1", project_id: "project-2", stage_id: "stage-2-1", title: "Разработка планировки", description: "Open-space планировка с переговорными комнатами", status: "in_progress", assignee_id: "user-1", checklist: [], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-02-01T10:00:00Z" },
  { id: "task-2-2", project_id: "project-2", stage_id: "stage-2-1", title: "Расчёт электрических нагрузок", description: "Подсчёт мощности для офисной техники и освещения", status: "not_started", assignee_id: "user-2", checklist: [], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-02-01T10:30:00Z" },
  { id: "task-2-3", project_id: "project-2", stage_id: "stage-2-2", title: "Монтаж стеклянных перегородок", description: "Установка перегородок для переговорных", status: "not_started", assignee_id: "user-2", checklist: [], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-02-02T09:00:00Z" },
  { id: "task-2-4", project_id: "project-2", stage_id: "stage-2-2", title: "Монтаж климатических систем", description: "Установка сплит-систем по офисным помещениям", status: "not_started", assignee_id: "user-2", checklist: [], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-02-02T09:30:00Z" },
  // Project 3 tasks — Благоустройство участка
  { id: "task-3-1", project_id: "project-3", stage_id: "stage-3-1", title: "Снятие старого газона", description: "Снять существующий газон и корневой слой", status: "done", assignee_id: "user-3", checklist: [{ id: "cl-3-1", text: "Передняя часть участка", done: true }, { id: "cl-3-2", text: "Задний двор", done: true }], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-10T08:00:00Z" },
  { id: "task-3-2", project_id: "project-3", stage_id: "stage-3-1", title: "Выравнивание грунта на заднем дворе", description: "Планировка и уплотнение грунта по проектным отметкам", status: "done", assignee_id: "user-3", checklist: [{ id: "cl-3-3", text: "Черновая планировка", done: true }, { id: "cl-3-4", text: "Уплотнение", done: true }], comments: [{ id: "com-3-1", author_id: "user-3", text: "Плотность уплотнения 95%", created_at: "2025-01-14T15:00:00Z" }], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-12T08:00:00Z" },
  { id: "task-3-3", project_id: "project-3", stage_id: "stage-3-2", title: "Устройство дренажной отсыпки", description: "Уложить щебень по периметру для отвода воды", status: "done", assignee_id: "user-2", checklist: [{ id: "cl-3-5", text: "Траншея 30 см", done: true }, { id: "cl-3-6", text: "Засыпка щебнем", done: true }], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-16T08:00:00Z" },
  { id: "task-3-4", project_id: "project-3", stage_id: "stage-3-2", title: "Укладка геотекстиля", description: "Покрыть спланированный участок геотекстилем", status: "done", assignee_id: "user-2", checklist: [], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-18T08:00:00Z" },
  { id: "task-3-5", project_id: "project-3", stage_id: "stage-3-2", title: "Монтаж бордюрной ленты", description: "Установка алюминиевых бордюров по контуру мощения", status: "done", assignee_id: "user-2", checklist: [{ id: "cl-3-7", text: "Северная сторона", done: true }, { id: "cl-3-8", text: "Южная сторона", done: true }, { id: "cl-3-9", text: "Восточная сторона", done: true }], comments: [{ id: "com-3-2", author_id: "user-2", text: "Все стороны выставлены, готово к мощению", created_at: "2025-01-22T16:00:00Z" }], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-20T08:00:00Z" },
  { id: "task-3-6", project_id: "project-3", stage_id: "stage-3-3", title: "Устройство подстилающего слоя", description: "Разровнять и уплотнить песчано-щебёночную смесь", status: "in_progress", assignee_id: "user-2", checklist: [{ id: "cl-3-10", text: "Распределить смесь", done: true }, { id: "cl-3-11", text: "Выровнять по маякам", done: false }, { id: "cl-3-12", text: "Финальное уплотнение", done: false }], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-25T08:00:00Z" },
  { id: "task-3-7", project_id: "project-3", stage_id: "stage-3-3", title: "Укладка первого ряда брусчатки", description: "Натянуть шнур и уложить первый ряд", status: "in_progress", assignee_id: "user-2", checklist: [{ id: "cl-3-13", text: "Шнур натянут", done: true }, { id: "cl-3-14", text: "Первый ряд уложен", done: false }], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-27T08:00:00Z" },
  { id: "task-3-8", project_id: "project-3", stage_id: "stage-3-3", title: "Прокладка ирригационных трасс", description: "Уложить капельный полив до финишного мощения", status: "in_progress", assignee_id: "user-3", checklist: [{ id: "cl-3-15", text: "Основная магистраль", done: true }, { id: "cl-3-16", text: "Зона капельного полива A", done: false }, { id: "cl-3-17", text: "Зона капельного полива Б", done: false }], comments: [], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-28T08:00:00Z" },
  { id: "task-3-9", project_id: "project-3", stage_id: "stage-3-4", title: "Поставка декоративного гравия", description: "Принять и распределить декоративный гравий по клумбам", status: "blocked", assignee_id: "user-2", checklist: [], comments: [{ id: "com-3-3", author_id: "user-2", text: "Задержка у поставщика, ждём на следующей неделе", created_at: "2025-02-01T10:00:00Z" }], attachments: [], photos: [], linked_estimate_item_ids: [], created_at: "2025-01-30T08:00:00Z" },
];

export const seedEstimates: Estimate[] = [
  {
    project_id: "project-1",
    versions: [
      {
        id: "ev-1-1", project_id: "project-1", number: 1, status: "approved",
        items: [
          { id: "ei-1-1", version_id: "ev-1-1", stage_id: "stage-1-1", type: "work", title: "Снятие напольных покрытий", unit: "м²", qty: 65, planned_cost: 19500, paid_cost: 19500 },
          { id: "ei-1-2", version_id: "ev-1-1", stage_id: "stage-1-1", type: "work", title: "Демонтаж плитки", unit: "м²", qty: 12, planned_cost: 6000, paid_cost: 6000 },
          { id: "ei-1-3", version_id: "ev-1-1", stage_id: "stage-1-2", type: "work", title: "Черновая электрика", unit: "точка", qty: 24, planned_cost: 48000, paid_cost: 20000 },
          { id: "ei-1-4", version_id: "ev-1-1", stage_id: "stage-1-2", type: "work", title: "Черновая сантехника", unit: "точка", qty: 8, planned_cost: 32000, paid_cost: 0 },
          { id: "ei-1-5", version_id: "ev-1-1", stage_id: "stage-1-3", type: "material", title: "Гипсокартон КНАУФ 12.5мм", unit: "шт", qty: 40, planned_cost: 24000, paid_cost: 0 },
          { id: "ei-1-6", version_id: "ev-1-1", stage_id: "stage-1-3", type: "material", title: "Плитка керамогранит 60×60", unit: "м²", qty: 18, planned_cost: 36000, paid_cost: 0 },
        ],
      },
    ],
  },
  {
    project_id: "project-2",
    versions: [
      {
        id: "ev-2-1", project_id: "project-2", number: 1, status: "draft",
        items: [
          { id: "ei-2-1", version_id: "ev-2-1", stage_id: "stage-2-1", type: "work", title: "Проектирование и дизайн пространства", unit: "проект", qty: 1, planned_cost: 80000, paid_cost: 0 },
          { id: "ei-2-2", version_id: "ev-2-1", stage_id: "stage-2-2", type: "material", title: "Стеклянные перегородки", unit: "м²", qty: 30, planned_cost: 150000, paid_cost: 0 },
          { id: "ei-2-3", version_id: "ev-2-1", stage_id: "stage-2-2", type: "work", title: "Монтаж кондиционеров", unit: "шт", qty: 6, planned_cost: 120000, paid_cost: 0 },
        ],
      },
    ],
  },
  {
    project_id: "project-3",
    versions: [
      {
        id: "ev-3-1", project_id: "project-3", number: 1, status: "approved",
        items: [
          { id: "ei-3-1", version_id: "ev-3-1", stage_id: "stage-3-1", type: "work", title: "Расчистка территории и снятие газона", unit: "м²", qty: 200, planned_cost: 30000, paid_cost: 30000 },
          { id: "ei-3-2", version_id: "ev-3-1", stage_id: "stage-3-1", type: "work", title: "Планировка и уплотнение грунта", unit: "м²", qty: 200, planned_cost: 25000, paid_cost: 25000 },
          { id: "ei-3-3", version_id: "ev-3-1", stage_id: "stage-3-2", type: "material", title: "Щебень дренажный фр. 20–40", unit: "м³", qty: 8, planned_cost: 32000, paid_cost: 32000 },
          { id: "ei-3-4", version_id: "ev-3-1", stage_id: "stage-3-2", type: "material", title: "Геотекстиль дорнит 150г/м²", unit: "м²", qty: 150, planned_cost: 18000, paid_cost: 18000 },
          { id: "ei-3-5", version_id: "ev-3-1", stage_id: "stage-3-2", type: "material", title: "Бордюр газонный алюминиевый", unit: "м", qty: 60, planned_cost: 15000, paid_cost: 15000 },
          { id: "ei-3-6", version_id: "ev-3-1", stage_id: "stage-3-2", type: "work", title: "Монтаж дренажа", unit: "м", qty: 40, planned_cost: 40000, paid_cost: 40000 },
          { id: "ei-3-7", version_id: "ev-3-1", stage_id: "stage-3-3", type: "material", title: "Брусчатка бетонная 20×10×6", unit: "м²", qty: 120, planned_cost: 144000, paid_cost: 80000 },
          { id: "ei-3-8", version_id: "ev-3-1", stage_id: "stage-3-3", type: "work", title: "Укладка брусчатки", unit: "м²", qty: 120, planned_cost: 48000, paid_cost: 20000 },
          { id: "ei-3-9", version_id: "ev-3-1", stage_id: "stage-3-3", type: "material", title: "Ирригационные материалы", unit: "комплект", qty: 1, planned_cost: 25000, paid_cost: 15000 },
          { id: "ei-3-10", version_id: "ev-3-1", stage_id: "stage-3-4", type: "material", title: "Декоративный гравий", unit: "м³", qty: 3, planned_cost: 18000, paid_cost: 0 },
          { id: "ei-3-11", version_id: "ev-3-1", stage_id: "stage-3-4", type: "work", title: "Посадка растений и финишные работы", unit: "проект", qty: 1, planned_cost: 25000, paid_cost: 0 },
        ],
      },
    ],
  },
];

export const seedProcurementItems: ProcurementItem[] = [
  { id: "proc-1-1", project_id: "project-1", stage_id: "stage-1-2", estimate_item_id: "ei-1-3", title: "Кабель ВВГнг 3×2.5", unit: "м", qty: 200, in_stock: 200, cost: 8000, status: "purchased" },
  { id: "proc-1-2", project_id: "project-1", stage_id: "stage-1-2", estimate_item_id: "ei-1-4", title: "Трубы ПП 20мм", unit: "м", qty: 50, in_stock: 0, cost: 5000, status: "not_purchased" },
  { id: "proc-1-3", project_id: "project-1", stage_id: "stage-1-3", estimate_item_id: "ei-1-5", title: "Гипсокартон КНАУФ 12.5мм", unit: "шт", qty: 40, in_stock: 0, cost: 24000, status: "not_purchased" },
  { id: "proc-1-4", project_id: "project-1", stage_id: "stage-1-3", estimate_item_id: "ei-1-6", title: "Плитка керамогранит 60×60", unit: "м²", qty: 18, in_stock: 0, cost: 36000, status: "not_purchased" },
  { id: "proc-2-1", project_id: "project-2", stage_id: "stage-2-2", estimate_item_id: "ei-2-2", title: "Стеклянные перегородки", unit: "м²", qty: 30, in_stock: 0, cost: 150000, status: "not_purchased" },
  { id: "proc-3-1", project_id: "project-3", stage_id: "stage-3-3", estimate_item_id: "ei-3-7", title: "Брусчатка бетонная 20×10×6", unit: "м²", qty: 120, in_stock: 120, cost: 144000, status: "purchased" },
  { id: "proc-3-2", project_id: "project-3", stage_id: "stage-3-2", estimate_item_id: "ei-3-3", title: "Щебень дренажный фр. 20–40", unit: "м³", qty: 8, in_stock: 5, cost: 32000, status: "purchased" },
  { id: "proc-3-3", project_id: "project-3", stage_id: "stage-3-2", estimate_item_id: "ei-3-4", title: "Геотекстиль дорнит 150г/м²", unit: "м²", qty: 150, in_stock: 150, cost: 18000, status: "purchased" },
  { id: "proc-3-4", project_id: "project-3", stage_id: "stage-3-4", estimate_item_id: "ei-3-10", title: "Декоративный гравий", unit: "м³", qty: 3, in_stock: 0, cost: 18000, status: "not_purchased" },
  { id: "proc-3-5", project_id: "project-3", stage_id: "stage-3-2", estimate_item_id: "ei-3-5", title: "Бордюр газонный алюминиевый", unit: "м", qty: 60, in_stock: 60, cost: 15000, status: "purchased" },
];

export const seedDocuments: Document[] = [
  {
    id: "doc-1-1",
    project_id: "project-1",
    type: "contract",
    title: "Договор подряда №1",
    origin: "project_creation",
    created_at: "2025-01-09T09:00:00Z",
    visibility_class: "shared_project",
    versions: [{ id: "dv-1-1", document_id: "doc-1-1", number: 1, status: "active", content: "Договор подряда на выполнение ремонтных работ в квартире. Подрядчик обязуется выполнить работы в согласованные сроки..." }],
  },
  {
    id: "doc-1-2",
    project_id: "project-1",
    type: "specification",
    title: "Схема электропроводки",
    created_at: "2025-01-16T09:00:00Z",
    visibility_class: "internal",
    versions: [{ id: "dv-1-2", document_id: "doc-1-2", number: 1, status: "draft", content: "Подробная спецификация электропроводки с указанием точек подключения и сечений кабеля..." }],
  },
  {
    id: "doc-2-1",
    project_id: "project-2",
    type: "contract",
    title: "Договор на отделку офиса",
    origin: "project_creation",
    created_at: "2025-02-03T14:00:00Z",
    visibility_class: "shared_project",
    versions: [{ id: "dv-2-1", document_id: "doc-2-1", number: 1, status: "awaiting_approval", content: "Договор на проведение отделочных работ в офисном помещении..." }],
  },
  {
    id: "doc-3-1",
    project_id: "project-3",
    type: "specification",
    title: "План благоустройства участка",
    created_at: "2025-01-10T10:00:00Z",
    visibility_class: "shared_project",
    versions: [
      { id: "dv-3-1", document_id: "doc-3-1", number: 2, status: "active", content: "Ландшафтный план с зонами мощения, клумбами и системой полива..." },
      { id: "dv-3-1b", document_id: "doc-3-1", number: 1, status: "active", content: "Первоначальная концепция благоустройства..." },
    ],
  },
  {
    id: "doc-3-2",
    project_id: "project-3",
    type: "specification",
    title: "Схема системы полива",
    created_at: "2025-01-18T10:00:00Z",
    visibility_class: "shared_project",
    versions: [{ id: "dv-3-2", document_id: "doc-3-2", number: 1, status: "active", content: "Схема капельного полива для зон A и Б с расчётом расхода воды..." }],
  },
  {
    id: "doc-3-3",
    project_id: "project-3",
    type: "specification",
    title: "Техническое задание на материалы",
    created_at: "2025-01-24T10:00:00Z",
    visibility_class: "internal",
    versions: [{ id: "dv-3-3", document_id: "doc-3-3", number: 1, status: "draft", content: "Характеристики брусчатки, фракция гравия, параметры бордюров..." }],
  },
];

export const seedMedia: Media[] = [
  { id: "media-1-1", project_id: "project-1", task_id: "task-1-1", uploader_id: "user-2", caption: "Демонтаж старого покрытия — гостиная", is_final: false, created_at: "2025-01-14T16:00:00Z", visibility_class: "shared_project" },
  { id: "media-1-2", project_id: "project-1", task_id: "task-1-2", uploader_id: "user-2", caption: "Плитка в ванной снята", is_final: false, created_at: "2025-01-18T11:00:00Z", visibility_class: "shared_project" },
  { id: "media-1-3", project_id: "project-1", task_id: "task-1-3", uploader_id: "user-2", caption: "Укладка кабелей на кухне", is_final: false, created_at: "2025-02-05T09:00:00Z", visibility_class: "internal" },
  { id: "media-2-1", project_id: "project-2", uploader_id: "user-1", caption: "Текущее состояние офиса — до отделки", is_final: false, created_at: "2025-02-01T10:00:00Z", visibility_class: "shared_project" },
  { id: "media-3-1", project_id: "project-3", task_id: "task-3-2", uploader_id: "user-3", caption: "Выровненный грунт перед мощением", is_final: false, created_at: "2025-01-14T16:00:00Z", visibility_class: "shared_project" },
  { id: "media-3-2", project_id: "project-3", task_id: "task-3-3", uploader_id: "user-2", caption: "Дренажная траншея крупным планом", is_final: false, created_at: "2025-01-17T11:00:00Z", visibility_class: "internal" },
  { id: "media-3-3", project_id: "project-3", task_id: "task-3-5", uploader_id: "user-2", caption: "Смонтированный бордюр", is_final: false, created_at: "2025-01-22T16:30:00Z", visibility_class: "shared_project" },
  { id: "media-3-4", project_id: "project-3", task_id: "task-3-7", uploader_id: "user-2", caption: "Проверка разметки под брусчатку", is_final: false, created_at: "2025-01-28T10:00:00Z", visibility_class: "internal" },
];

export const seedEvents: Event[] = [
  { id: "evt-1", project_id: "project-1", actor_id: "user-1", type: "task_created", object_type: "task", object_id: "task-1-1", timestamp: "2025-01-10T09:00:00Z", payload: { title: "Снятие старых покрытий" } },
  { id: "evt-2", project_id: "project-1", actor_id: "user-2", type: "task_completed", object_type: "task", object_id: "task-1-1", timestamp: "2025-01-15T10:00:00Z", payload: { title: "Снятие старых покрытий" } },
  { id: "evt-3", project_id: "project-1", actor_id: "user-2", type: "task_completed", object_type: "task", object_id: "task-1-2", timestamp: "2025-01-20T14:00:00Z", payload: { title: "Демонтаж плитки в ванной" } },
  { id: "evt-4", project_id: "project-1", actor_id: "user-1", type: "estimate_approved", object_type: "estimate_version", object_id: "ev-1-1", timestamp: "2025-01-12T11:00:00Z", payload: { version: 1 } },
  { id: "evt-5", project_id: "project-1", actor_id: "user-2", type: "photo_uploaded", object_type: "media", object_id: "media-1-1", timestamp: "2025-01-14T16:00:00Z", payload: { caption: "Демонтаж старого покрытия — гостиная" } },
  { id: "evt-6", project_id: "project-1", actor_id: "user-2", type: "comment_added", object_type: "task", object_id: "task-1-6", timestamp: "2025-02-10T14:30:00Z", payload: { text: "Ждём завершения черновой сантехники" } },
  { id: "evt-7", project_id: "project-1", actor_id: "user-1", type: "member_added", object_type: "member", object_id: "user-3", timestamp: "2025-01-08T09:00:00Z", payload: { name: "Дмитрий Соколов", role: "viewer" } },
  { id: "evt-8", project_id: "project-2", actor_id: "user-1", type: "task_created", object_type: "task", object_id: "task-2-1", timestamp: "2025-02-01T10:00:00Z", payload: { title: "Разработка планировки" } },
  { id: "evt-9", project_id: "project-2", actor_id: "user-1", type: "estimate_created", object_type: "estimate_version", object_id: "ev-2-1", timestamp: "2025-02-02T11:00:00Z", payload: { version: 1 } },
  { id: "evt-10", project_id: "project-2", actor_id: "user-1", type: "document_uploaded", object_type: "document", object_id: "doc-2-1", timestamp: "2025-02-03T14:00:00Z", payload: { title: "Договор на отделку офиса" } },
  { id: "evt-11", project_id: "project-3", actor_id: "user-1", type: "task_created", object_type: "task", object_id: "task-3-1", timestamp: "2025-01-10T08:00:00Z", payload: { title: "Снятие старого газона" } },
  { id: "evt-12", project_id: "project-3", actor_id: "user-3", type: "task_completed", object_type: "task", object_id: "task-3-1", timestamp: "2025-01-12T17:00:00Z", payload: { title: "Снятие старого газона" } },
  { id: "evt-13", project_id: "project-3", actor_id: "user-3", type: "task_completed", object_type: "task", object_id: "task-3-2", timestamp: "2025-01-14T17:00:00Z", payload: { title: "Выравнивание грунта на заднем дворе" } },
  { id: "evt-14", project_id: "project-3", actor_id: "user-3", type: "photo_uploaded", object_type: "media", object_id: "media-3-1", timestamp: "2025-01-14T16:00:00Z", payload: { caption: "Выровненный грунт перед мощением" } },
  { id: "evt-15", project_id: "project-3", actor_id: "user-1", type: "estimate_approved", object_type: "estimate_version", object_id: "ev-3-1", timestamp: "2025-01-15T10:00:00Z", payload: { version: 1 } },
  { id: "evt-16", project_id: "project-3", actor_id: "user-2", type: "task_completed", object_type: "task", object_id: "task-3-5", timestamp: "2025-01-22T16:00:00Z", payload: { title: "Монтаж бордюрной ленты" } },
  { id: "evt-17", project_id: "project-3", actor_id: "user-2", type: "photo_uploaded", object_type: "media", object_id: "media-3-3", timestamp: "2025-01-22T16:30:00Z", payload: { caption: "Смонтированный бордюр" } },
  { id: "evt-18", project_id: "project-3", actor_id: "user-2", type: "comment_added", object_type: "task", object_id: "task-3-9", timestamp: "2025-02-01T10:00:00Z", payload: { text: "Задержка у поставщика, ждём на следующей неделе" } },
];

export const seedNotifications: Notification[] = [
  { id: "notif-1", user_id: "user-1", project_id: "project-1", event_id: "evt-2", is_read: true },
  { id: "notif-2", user_id: "user-1", project_id: "project-1", event_id: "evt-3", is_read: true },
  { id: "notif-3", user_id: "user-1", project_id: "project-1", event_id: "evt-5", is_read: false },
  { id: "notif-4", user_id: "user-1", project_id: "project-1", event_id: "evt-6", is_read: false },
  { id: "notif-5", user_id: "user-1", project_id: "project-3", event_id: "evt-18", is_read: false },
];

export const seedInvites: WorkspaceProjectInvite[] = [
  {
    id: "invite-1-1",
    project_id: "project-1",
    email: "plitka@master.ru",
    role: "contractor",
    ai_access: "consult_only",
    viewer_regime: "contractor",
    credit_limit: 0,
    invited_by: "user-1",
    status: "pending",
    invite_token: "invite-token-1-1",
    add_to_org_id: null,
    accepted_profile_id: null,
    created_at: "2026-04-15T09:30:00Z",
    accepted_at: null,
    expires_at: "2026-04-29T09:30:00Z",
    finance_visibility: "summary",
    internal_docs_visibility: "view",
  },
  {
    id: "invite-1-2",
    project_id: "project-1",
    email: "client@apartment.ru",
    role: "viewer",
    ai_access: "none",
    viewer_regime: "client",
    credit_limit: 0,
    invited_by: "user-1",
    status: "accepted",
    invite_token: "invite-token-1-2",
    add_to_org_id: null,
    accepted_profile_id: null,
    created_at: "2026-03-20T11:00:00Z",
    accepted_at: "2026-03-22T08:15:00Z",
    expires_at: "2026-04-03T11:00:00Z",
    finance_visibility: "summary",
    internal_docs_visibility: "view",
  },
  {
    id: "invite-2-1",
    project_id: "project-2",
    email: "design@studio.ru",
    role: "co_owner",
    ai_access: "project_pool",
    viewer_regime: null,
    credit_limit: 100,
    invited_by: "user-1",
    status: "pending",
    invite_token: "invite-token-2-1",
    add_to_org_id: null,
    accepted_profile_id: null,
    created_at: "2026-04-18T14:20:00Z",
    accepted_at: null,
    expires_at: "2026-05-02T14:20:00Z",
    finance_visibility: "detail",
    internal_docs_visibility: "edit",
  },
  {
    id: "invite-2-2",
    project_id: "project-2",
    email: "old-contact@expired.ru",
    role: "viewer",
    ai_access: "none",
    viewer_regime: "client",
    credit_limit: 0,
    invited_by: "user-1",
    status: "expired",
    invite_token: "invite-token-2-2",
    add_to_org_id: null,
    accepted_profile_id: null,
    created_at: "2026-02-10T10:00:00Z",
    accepted_at: null,
    expires_at: "2026-02-24T10:00:00Z",
    finance_visibility: "none",
    internal_docs_visibility: "none",
  },
  {
    id: "invite-3-1",
    project_id: "project-3",
    email: "landscape@pro.ru",
    role: "contractor",
    ai_access: "consult_only",
    viewer_regime: "contractor",
    credit_limit: 50,
    invited_by: "user-1",
    status: "pending",
    invite_token: "invite-token-3-1",
    add_to_org_id: null,
    accepted_profile_id: null,
    created_at: "2026-04-20T10:00:00Z",
    accepted_at: null,
    expires_at: "2026-05-04T10:00:00Z",
    finance_visibility: "summary",
    internal_docs_visibility: "view",
  },
  {
    id: "invite-3-2",
    project_id: "project-3",
    email: "revoked@contractor.ru",
    role: "contractor",
    ai_access: "consult_only",
    viewer_regime: "contractor",
    credit_limit: 0,
    invited_by: "user-1",
    status: "revoked",
    invite_token: "invite-token-3-2",
    add_to_org_id: null,
    accepted_profile_id: null,
    created_at: "2026-03-05T15:00:00Z",
    accepted_at: null,
    expires_at: "2026-03-19T15:00:00Z",
    finance_visibility: "none",
    internal_docs_visibility: "none",
  },
];

export const allUsers: User[] = [seedUser, ...otherUsers];
