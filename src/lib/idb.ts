/**
 * One IndexedDB connection per database, kept honest.
 *
 * Both local stores (media cache, sounds) used to open a connection once and
 * reuse the promise for the life of the page. When the browser closes that
 * connection on its own — storage cleared, disk pressure, another tab
 * upgrading the database, Chrome tearing down an idle backing store — every
 * later `db.transaction()` throws "Failed to execute 'transaction' on
 * 'IDBDatabase': The database connection is closing", and adding a
 * background kept failing until the page was reloaded.
 *
 * This drops the cached connection whenever it closes, retries a transaction
 * once on a fresh connection, and repairs a database that exists without the
 * store it is supposed to hold (bumping the version so `onupgradeneeded` runs).
 */

export interface StoreSpec {
  name: string;
  store: string;
  /** Called inside `onupgradeneeded` when the store is missing. */
  create: (db: IDBDatabase) => void;
  /** Turns a failed open into the caller's own error type. */
  openError: (cause: unknown) => Error;
}

export function connection(spec: StoreSpec) {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function forget(db?: IDBDatabase) {
    dbPromise = null;
    try {
      db?.close();
    } catch {
      /* already closed */
    }
  }

  function openAt(version?: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(spec.openError(new Error('This browser has no IndexedDB.')));
        return;
      }
      const request = version ? indexedDB.open(spec.name, version) : indexedDB.open(spec.name);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(spec.store)) spec.create(db);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(spec.openError(request.error));
      request.onblocked = () => {
        // Another tab holds an older connection open; it will get a
        // versionchange and close (see below), after which this proceeds.
      };
    });
  }

  async function open(): Promise<IDBDatabase> {
    let db = await openAt();
    if (!db.objectStoreNames.contains(spec.store)) {
      // The database exists but without our store: an old or half-written
      // copy. Only an upgrade can add a store, so reopen one version higher.
      const next = db.version + 1;
      db.close();
      db = await openAt(next);
    }
    db.onclose = () => forget();
    db.onversionchange = () => forget(db);
    return db;
  }

  function get(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = open().catch((error) => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  }

  function attempt<T>(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(spec.store, mode);
      const request = work(transaction.objectStore(spec.store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error ?? request.error);
    });
  }

  /** Runs one request in its own transaction, reconnecting once if needed. */
  async function run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await get();
    try {
      return await attempt(db, mode, work);
    } catch (error) {
      // InvalidStateError: the connection is closing. NotFoundError: the
      // store vanished under us. Both are fixed by a fresh connection; any
      // other failure (quota, a bad value) is real and goes to the caller.
      const name = (error as DOMException | null)?.name;
      if (name !== 'InvalidStateError' && name !== 'NotFoundError') throw error;
      forget(db);
      return attempt(await get(), mode, work);
    }
  }

  return { run };
}
