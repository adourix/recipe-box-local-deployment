/**
 * Run tasks in the persistent Node.js process after preparing the HTTP response.
 * Unlike Vercel waitUntil, this does not survive a process crash/restart.
 */
export function runInBackground(task: Promise<unknown> | (() => Promise<unknown>)): void {
  setImmediate(() => {
    void Promise.resolve()
      .then(() => (typeof task === "function" ? task() : task))
      .catch((error) => console.error("[background-task] failed", error));
  });
}
