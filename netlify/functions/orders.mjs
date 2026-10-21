import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";

const STORE_NAME = "tricocotte-boulot-commandes";

// Boîtes de 6 œufs : prix en centimes, par calibre.
const SIZES = {
  M: { label: "Taille M", cents: 240 },
  L: { label: "Taille L", cents: 280 },
  XL: { label: "Taille XL", cents: 300 }
};
const MAX_PER_SIZE = 10;
const MAX_TOTAL = 20;

// Livraison chaque lundi matin. Commandes ouvertes jusqu'au dimanche à cette heure (Paris) ;
// au-delà, la commande bascule sur le lundi suivant.
const DELIVERY_WEEKDAY = 1;
const CUTOFF_HOUR = 18;

const reply = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

const store = () => getStore({ name: STORE_NAME, consistency: "strong" });
const keyFor = (id) => "orders/" + id;
const isId = (value) => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);

function safeEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function signingSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.CHRISTELLE_PASSWORD || "";
}

function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return payload + "." + signature;
}

function isAdmin(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !signingSecret()) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expected = createHmac("sha256", signingSecret()).update(parts[0]).digest("base64url");
  if (!safeEquals(parts[1], expected)) return false;
  try {
    return JSON.parse(Buffer.from(parts[0], "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}

// Heure actuelle à Paris, quel que soit le fuseau du serveur.
function parisNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    weekday: weekdays[map.weekday]
  };
}

function isoDatePlusDays(year, month, day, addDays) {
  return new Date(Date.UTC(year, month - 1, day + addDays)).toISOString().slice(0, 10);
}

// Prochain lundi de livraison : le lundi à venir, sauf si on est dimanche après l'heure limite
// ou lundi (la tournée est alors déjà partie) — dans ce cas, le lundi d'après.
function nextDeliveryDate() {
  const now = parisNow();
  let daysUntil = (DELIVERY_WEEKDAY - now.weekday + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  if (now.weekday === 0 && now.hour >= CUTOFF_HOUR) daysUntil += 7;
  return isoDatePlusDays(now.year, now.month, now.day, daysUntil);
}

async function listOrders() {
  const dataStore = store();
  const { blobs } = await dataStore.list({ prefix: "orders/" });
  const orders = await Promise.all(blobs.map((blob) => dataStore.get(blob.key, { type: "json" })));
  return orders.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function createOrder(body) {
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (name.length < 2 || name.length > 80) return reply({ error: "Merci d’indiquer un nom valide." }, 400);
  if (phone.length > 30) return reply({ error: "Le numéro est trop long." }, 400);

  const items = {};
  let boxes = 0;
  let totalCents = 0;
  for (const size of Object.keys(SIZES)) {
    const qty = Number(body.items?.[size] ?? 0);
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_PER_SIZE) {
      return reply({ error: "Quantité invalide pour la taille " + size + " (0 à " + MAX_PER_SIZE + ")." }, 400);
    }
    items[size] = qty;
    boxes += qty;
    totalCents += qty * SIZES[size].cents;
  }
  if (boxes < 1) return reply({ error: "Choisissez au moins une boîte." }, 400);
  if (boxes > MAX_TOTAL) return reply({ error: "Maximum " + MAX_TOTAL + " boîtes par commande." }, 400);

  const order = {
    id: crypto.randomUUID(),
    name,
    phone,
    items,
    boxes,
    totalCents,
    deliveryDate: nextDeliveryDate(),
    done: false,
    createdAt: new Date().toISOString()
  };
  await store().setJSON(keyFor(order.id), order, { onlyIfNew: true });
  return reply({ order }, 201);
}

export default async (request) => {
  try {
    if (request.method === "POST") {
      const body = await request.json();
      if (body.action === "login") {
        const password = process.env.CHRISTELLE_PASSWORD;
        if (!password || !signingSecret()) return reply({ error: "La protection n’est pas encore configurée." }, 500);
        if (!safeEquals(body.password, password)) return reply({ error: "Mot de passe incorrect." }, 401);
        return reply({ token: makeToken() });
      }
      if (body.action === "create") return createOrder(body);
      return reply({ error: "Demande inconnue." }, 400);
    }

    if (!isAdmin(request)) return reply({ error: "Accès non autorisé." }, 401);

    if (request.method === "GET") return reply({ orders: await listOrders() });

    if (request.method === "PATCH") {
      const body = await request.json();
      if (!isId(body.id) || typeof body.done !== "boolean") return reply({ error: "Commande invalide." }, 400);
      const dataStore = store();
      const order = await dataStore.get(keyFor(body.id), { type: "json" });
      if (!order) return reply({ error: "Commande introuvable." }, 404);
      order.done = body.done;
      await dataStore.setJSON(keyFor(order.id), order);
      return reply({ order });
    }

    if (request.method === "DELETE") {
      const body = await request.json().catch(() => ({}));
      const deliveryDate = typeof body.deliveryDate === "string" ? body.deliveryDate : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) return reply({ error: "Précisez quelle livraison effacer." }, 400);
      const dataStore = store();
      const toDelete = (await listOrders()).filter((order) => order.deliveryDate === deliveryDate);
      await Promise.all(toDelete.map((order) => dataStore.delete(keyFor(order.id))));
      return reply({ cleared: toDelete.length });
    }

    return reply({ error: "Méthode non prise en charge." }, 405);
  } catch (error) {
    console.error(error);
    return reply({ error: "Un problème est survenu. Réessayez dans un instant." }, 500);
  }
};
