// Login, sessions, account links and self-moves through the real app. Each test sends its own
// X-Forwarded-For where it logs in, so the rate limit counters of one test can't affect another.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import request from "supertest";
import { startStack, seedBase, makeSite, makeEmployee, makeSupervisor, api, cookieFor, ok } from "../helpers/integration.js";

const PASSWORD = "pw-123456";
let stack, M, admin, superadmin;
let networkSeq = 0;

const newNetwork = () => `203.0.113.${++networkSeq}`;
const loginFrom = (network, body) =>
  request(stack.app).post("/api/user/login").set("X-Forwarded-For", network).send(body);
const sessionCookie = (res) => res.headers["set-cookie"].find((c) => c.startsWith("token=")).split(";")[0];
const employeesWith = (cookie) => request(stack.app).get("/api/employees").set("Cookie", cookie);

async function makeAdmin(email) {
  return M.User.create({ name: email, email, password: PASSWORD, role: "admin" });
}

/** A supervisor whose employee record is homed on their site, linked both ways. */
async function supervisorWithRecord(employeeId) {
  const site = await makeSite(M, `Home ${employeeId}`);
  const account = await makeSupervisor(M, site, employeeId);
  const record = await makeEmployee(M, employeeId, { currentSite: site._id, user: account._id });
  return { site, account, record };
}

async function assignedSiteOf(account) {
  return String((await M.User.findById(account._id).lean()).assignedSite);
}

before(async () => {
  stack = await startStack();
  ({ M, admin, superadmin } = await seedBase());
});
after(async () => stack?.stop());

describe("login", () => {
  test("query operators in the email or password are refused", async () => {
    const network = newNetwork();
    const attempts = [
      { email: { $ne: null }, password: PASSWORD },
      { email: admin.email, password: { $ne: null } },
    ];
    for (const body of attempts) {
      const res = await loginFrom(network, body);
      assert.equal(res.status, 403);
      assert.equal(res.headers["set-cookie"], undefined);
    }
  });

  test("a known and an unknown email get the same answer in every failure case", async () => {
    const network = newNetwork();
    const cases = [
      [{ email: admin.email }, { email: "nobody@t.test" }],
      [{ email: admin.email, password: "wrong" }, { email: "nobody@t.test", password: "wrong" }],
      [{ email: { $regex: "^admin" } }, { email: { $regex: "^zzz" } }],
    ];
    for (const [known, unknown] of cases) {
      const a = await loginFrom(network, known);
      const b = await loginFrom(network, unknown);
      assert.deepEqual([a.status, a.body], [b.status, b.body]);
    }
  });

  test("the right password still logs in, with any capitalisation of the email", async () => {
    const res = await loginFrom(newNetwork(), { email: admin.email.toUpperCase(), password: PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.password, undefined);
  });
});

describe("login rate limit", () => {
  test("10 failures block that email from that network, even with the right password", async () => {
    const user = await makeAdmin("limit-a@t.test");
    const network = newNetwork();
    for (let i = 0; i < 10; i++) {
      assert.equal((await loginFrom(network, { email: user.email, password: "wrong" })).status, 403);
    }
    assert.equal((await loginFrom(network, { email: user.email, password: PASSWORD })).status, 429);
  });

  test("the block doesn't reach the same user on another network, or another user", async () => {
    const user = await makeAdmin("limit-b@t.test");
    const other = await makeAdmin("limit-c@t.test");
    const network = newNetwork();
    for (let i = 0; i < 11; i++) await loginFrom(network, { email: user.email, password: "wrong" });

    assert.equal((await loginFrom(newNetwork(), { email: user.email, password: PASSWORD })).status, 200);
    assert.equal((await loginFrom(network, { email: other.email, password: PASSWORD })).status, 200);
  });

  test("successful logins don't count as failures", async () => {
    const user = await makeAdmin("limit-d@t.test");
    const network = newNetwork();
    for (let i = 0; i < 12; i++) {
      assert.equal((await loginFrom(network, { email: user.email, password: PASSWORD })).status, 200);
    }
  });

  test("one network is capped at 100 attempts across all emails", async () => {
    const network = newNetwork();
    for (let i = 0; i < 100; i++) {
      assert.equal((await loginFrom(network, { email: `spray${i}@t.test`, password: "x" })).status, 403);
    }
    assert.equal((await loginFrom(network, { email: "spray-last@t.test", password: "x" })).status, 429);
  });
});

describe("sessions", () => {
  test("a token from before this change keeps working, so deploying logs nobody out", async () => {
    const user = await makeAdmin("old-token@t.test");
    const old = `token=${jwt.sign({ id: String(user._id), role: "admin" }, process.env.JWT_SECRET)}`;
    assert.equal((await employeesWith(old)).status, 200);

    await M.User.collection.updateOne({ _id: user._id }, { $unset: { tokenVersion: "" } });
    assert.equal((await employeesWith(old)).status, 200, "an account with no stored version counts as 0");

    await request(stack.app).post("/api/user/logout").set("Cookie", old);
    assert.equal((await employeesWith(old)).status, 401, "logout still ends it");
  });

  test("a deleted user's token stops working", async () => {
    const user = await makeAdmin("deleted@t.test");
    const cookie = cookieFor(user);
    ok(await api(stack.app, superadmin).delete(`/api/user/${user._id}`), "delete");
    assert.equal((await employeesWith(cookie)).status, 401);
  });

  test("logout ends the session on every device", async () => {
    const user = await makeAdmin("logout@t.test");
    const network = newNetwork();
    const phone = sessionCookie(await loginFrom(network, { email: user.email, password: PASSWORD }));
    const laptop = sessionCookie(await loginFrom(network, { email: user.email, password: PASSWORD }));

    ok(await request(stack.app).post("/api/user/logout").set("Cookie", phone), "logout");
    assert.equal((await employeesWith(phone)).status, 401);
    assert.equal((await employeesWith(laptop)).status, 401);

    const again = sessionCookie(await loginFrom(network, { email: user.email, password: PASSWORD }));
    assert.equal((await employeesWith(again)).status, 200, "logging in again works");
  });

  test("an old token can't log the user out of a newer session", async () => {
    const user = await makeAdmin("stale@t.test");
    const network = newNetwork();
    const stale = sessionCookie(await loginFrom(network, { email: user.email, password: PASSWORD }));
    await request(stack.app).post("/api/user/logout").set("Cookie", stale);
    const fresh = sessionCookie(await loginFrom(network, { email: user.email, password: PASSWORD }));

    await request(stack.app).post("/api/user/logout").set("Cookie", stale);
    assert.equal((await employeesWith(fresh)).status, 200);
  });

  test("logout without a valid token still answers 200", async () => {
    ok(await request(stack.app).post("/api/user/logout"), "no cookie");
    ok(await request(stack.app).post("/api/user/logout").set("Cookie", "token=garbage"), "bad cookie");
  });

  test("a password change ends other sessions and the new password works", async () => {
    const user = await makeAdmin("reset@t.test");
    const network = newNetwork();
    const cookie = sessionCookie(await loginFrom(network, { email: user.email, password: PASSWORD }));

    ok(await api(stack.app, superadmin).patch(`/api/user/update/${user._id}`).send({ password: "brand-new-pass" }), "reset");
    assert.equal((await employeesWith(cookie)).status, 401);
    assert.equal((await loginFrom(network, { email: user.email, password: "brand-new-pass" })).status, 200);
  });

  test("changing only the email leaves sessions alone", async () => {
    const user = await makeAdmin("email-only@t.test");
    const cookie = cookieFor(user);
    ok(await api(stack.app, superadmin).patch(`/api/user/update/${user._id}`).send({ email: "email-new@t.test" }), "edit");
    assert.equal((await employeesWith(cookie)).status, 200);
  });

  test("changing your own password keeps this device logged in", async () => {
    const me = await M.User.create({ name: "Own", email: "own@t.test", password: PASSWORD, role: "superadmin" });
    const res = ok(await api(stack.app, me).patch(`/api/user/update/${me._id}`).send({ password: "brand-new-pass" }), "reset");
    assert.equal((await employeesWith(sessionCookie(res))).status, 200);
  });

  test("the role comes from the account, not the token", async () => {
    const user = await makeAdmin("demoted@t.test");
    const cookie = cookieFor(user); // the token still says admin
    await M.User.updateOne({ _id: user._id }, { $set: { role: "driverSupervisor" } });
    assert.equal((await employeesWith(cookie)).status, 403);
  });
});

describe("demo login", () => {
  const withDemoEnv = async (vars, fn) => {
    const all = { DEMO_LOGIN_TOKEN: "demo-token", DEMO_USER_ROLE: "admin", ...vars };
    const saved = Object.fromEntries(Object.keys(all).map((k) => [k, process.env[k]]));
    Object.assign(process.env, all);
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  const demoLogin = () =>
    request(stack.app).post("/api/user/demo-login").set("X-Forwarded-For", newNetwork()).send({ token: "demo-token" });

  test("is refused in production even when configured", async () => {
    const res = await withDemoEnv(
      { NODE_ENV: "production", DEMO_USER_EMAIL: "demo-prod@t.test", DEMO_USER_PASSWORD: "whatever-123" },
      demoLogin
    );
    assert.equal(res.status, 404);
    assert.equal(await M.User.findOne({ email: "demo-prod@t.test" }), null);
  });

  test("can't sign in as an existing account without its password", async () => {
    const res = await withDemoEnv({ DEMO_USER_EMAIL: superadmin.email, DEMO_USER_PASSWORD: "not-theirs" }, demoLogin);
    assert.equal(res.status, 403);
  });

  test("still works in development, on first use and after", async () => {
    const env = { DEMO_USER_EMAIL: "demo-dev@t.test", DEMO_USER_PASSWORD: "whatever-123" };
    assert.equal((await withDemoEnv(env, demoLogin)).status, 200);
    assert.equal((await withDemoEnv(env, demoLogin)).status, 200);
  });
});

describe("employee to account links", () => {
  const form = (employeeId, extra = {}) => ({ name: "Linked", employeeId, jobTitle: "Mason", ...extra });

  test("the employee form refuses a user field", async () => {
    const res = await api(stack.app, admin).post("/api/employees").send(form("LINK-1", { user: String(superadmin._id) }));
    assert.equal(res.status, 422);
    const emp = await makeEmployee(M, "LINK-2");
    const put = await api(stack.app, admin).put(`/api/employees/${emp._id}`).send(form("LINK-2", { user: String(superadmin._id) }));
    assert.equal(put.status, 422);
  });

  test("a link already stored to a superadmin can't rename or delete them", async () => {
    const emp = await makeEmployee(M, "LINK-3", { user: superadmin._id });
    const before = await M.User.findById(superadmin._id).lean();

    ok(await api(stack.app, admin).put(`/api/employees/${emp._id}`).send(form("LINK-3", { name: "Renamed" })), "edit");
    assert.equal((await M.User.findById(superadmin._id).lean()).name, before.name);

    ok(await api(stack.app, admin).delete(`/api/employees/${emp._id}`), "deactivate");
    assert.ok(await M.User.findById(superadmin._id), "the superadmin account must survive");
  });

  test("a link already stored to another supervisor can't move their access", async () => {
    const { site: victimSite, account: victim } = await supervisorWithRecord("LINK-4");
    const away = await makeSite(M, "Link away");
    const dummy = await makeEmployee(M, "LINK-5", { currentSite: victimSite._id, user: victim._id });

    ok(await api(stack.app, admin).put(`/api/employees/${dummy._id}`).send(form("LINK-5", { currentSite: String(away._id) })), "move dummy");
    assert.equal(await assignedSiteOf(victim), String(victimSite._id));
  });

  test("a real supervisor's record still works: renamed, access follows, deactivation deletes", async () => {
    const { account, record } = await supervisorWithRecord("LINK-6");
    const away = await makeSite(M, "Link real away");

    ok(
      await api(stack.app, admin)
        .put(`/api/employees/${record._id}`)
        .send(form("LINK-6", { name: "New Name", currentSite: String(away._id) })),
      "edit"
    );
    const after = await M.User.findById(account._id).lean();
    assert.equal(after.name, "New Name");
    assert.equal(String(after.assignedSite), String(away._id));

    ok(await api(stack.app, admin).delete(`/api/employees/${record._id}`), "deactivate");
    assert.equal(await M.User.findById(account._id), null);
  });
});

describe("a supervisor moving their own record", () => {
  const send = (client, site, record, toSite, mode) =>
    client.post(`/api/site/${site._id}/send-employee`).send({ empId: String(record._id), toSiteId: String(toSite._id), mode });

  for (const mode of ["permanent", "scheduled"]) {
    test(`send to site, ${mode}: refused`, async () => {
      const { site, account, record } = await supervisorWithRecord(`SELF-${mode}`);
      const res = await send(api(stack.app, account), site, record, await makeSite(M, `To ${mode}`), mode);
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "SELF_MOVE");
      assert.equal(await assignedSiteOf(account), String(site._id));
    });
  }

  test("send to site for today is still allowed and leaves access alone", async () => {
    const { site, account, record } = await supervisorWithRecord("SELF-TODAY");
    ok(await send(api(stack.app, account), site, record, await makeSite(M, "To today"), "today"), "visit");
    assert.equal(await assignedSiteOf(account), String(site._id));
  });

  test("remove and schedule removal from their own site: refused", async () => {
    const { site, account, record } = await supervisorWithRecord("SELF-RM");
    const client = api(stack.app, account);
    assert.equal((await client.patch(`/api/site/${site._id}/remove-employee`).send({ _id: String(record._id) })).status, 403);
    assert.equal((await client.patch(`/api/site/${site._id}/schedule-removal`).send({ _id: String(record._id) })).status, 403);
    assert.equal(await assignedSiteOf(account), String(site._id));
  });

  test("a permanent midday transfer: refused", async () => {
    const { site, account, record } = await supervisorWithRecord("SELF-TR");
    const toSite = await makeSite(M, "To transfer");
    const res = await api(stack.app, account).post("/api/attendance/transfer").send({
      employeeId: String(record._id),
      fromSiteId: String(site._id),
      toSiteId: String(toSite._id),
      date: new Date().toISOString().slice(0, 10),
      onlyForToday: false,
    });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(await assignedSiteOf(account), String(site._id));
  });

  test("a supervisor can still move a colleague's record, and access follows", async () => {
    const { site, account } = await supervisorWithRecord("COLL-A");
    const colleagueId = "COLL-B";
    const colleague = await makeSupervisor(M, site, colleagueId);
    const record = await makeEmployee(M, colleagueId, { currentSite: site._id, user: colleague._id });
    const toSite = await makeSite(M, "To colleague");

    ok(await send(api(stack.app, account), site, record, toSite, "permanent"), "send colleague");
    assert.equal(await assignedSiteOf(colleague), String(toSite._id));
  });

  test("an admin can still move a supervisor's record, and access follows", async () => {
    const { site, account, record } = await supervisorWithRecord("SELF-ADM");
    const toSite = await makeSite(M, "To admin");
    ok(await send(api(stack.app, admin), site, record, toSite, "permanent"), "admin send");
    assert.equal(await assignedSiteOf(account), String(toSite._id));
  });
});

describe("removed endpoints", () => {
  test("the add-session route is gone", async () => {
    const res = await api(stack.app, admin).post("/api/attendance/64b000000000000000000001/sessions").send({});
    assert.equal(res.status, 404);
  });
});
