import { uuidv7 } from 'uuidv7';

/**
 * Every id is generated on the client, never by the server.
 *
 * An offline create needs its final identity the instant it exists, because a
 * subtask, three tag rows and two reminders all reference the task before any
 * network call happens. Server-assigned ids would force a temp-id to real-id
 * remap across the whole local object graph on every sync, and that remap is the
 * most bug-dense part of any offline client.
 *
 * UUIDv7 rather than v4 because it is time-ordered, which gives B-tree insert
 * locality in Postgres and a usable natural sort locally.
 */
export function newId(): string {
  return uuidv7();
}

/** Server idempotency key for one outbox record. */
export function newMutationId(): string {
  return uuidv7();
}

/** Groups outbox records that must apply in a single server transaction. */
export function newBatchId(): string {
  return uuidv7();
}

const CLIENT_ID_KEY = 'tend.clientId';

/**
 * Stable per install. Used for logs and device attribution, so a "which device
 * wrote this" question has an answer. Not a security boundary.
 */
export function getClientId(): string {
  if (typeof localStorage === 'undefined') return 'server';
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = uuidv7();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
