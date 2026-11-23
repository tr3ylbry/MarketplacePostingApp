// @vitest-environment node
import { parse } from "pg-connection-string";
import { localDatabase, openLocalDatabasePool, openLocalSessionReader, LOCAL_ORIGIN } from "../../scripts/local-session";

const mocks = vi.hoisted(() => ({
  pools: [] as Array<Record<string, unknown>>,
  blocked: vi.fn(() => { throw Error("Unexpected connection/provider/configuration access"); }),
}));
vi.mock("pg", () => ({ Pool: class {
  constructor(options: Record<string, unknown>) { mocks.pools.push(options); }
  on() { return this; }
  end() { return Promise.resolve(); }
  query = mocks.blocked;
  connect = mocks.blocked;
} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession: mocks.blocked } }) }));
vi.mock("../../src/auth/options", () => ({ authOptions: () => ({ session: { cookieCache: { enabled: false } } }) }));
vi.mock("dotenv", () => ({ config: mocks.blocked }));

const base = "postgresql://127.0.0.1:5432/synthetic_test";
const environment = (value = base): NodeJS.ProcessEnv => ({ NODE_ENV: "test", DATABASE_URL: value, BETTER_AUTH_URL: LOCAL_ORIGIN });
const rejected = [
  "host=remote.invalid", "%68ost=remote.invalid", "host=127.0.0.1&host=remote.invalid",
  "host=remote.invalid&host=127.0.0.1", "host=127.0.0.1&%68ost=remote.invalid", "%2568ost=remote.invalid",
  "port=6432", "hostaddr=192.0.2.1", "service=synthetic", "servicefile=/synthetic/no-read.conf",
  "connectionString=postgresql%3A%2F%2Fremote.invalid%2Fsynthetic_test", "dbname=another_test",
  "sslcert=/synthetic/no-read.pem", "sslkey=/synthetic/no-read.pem", "sslrootcert=/synthetic/no-read.pem",
  "sslnegotiation=direct", "sslmode=no-verify", "application_name=one&%61pplication_name=two",
  "options=one&options=two", "sslmode=disable&%73slmode=verify-full",
];
beforeEach(() => { mocks.pools.length = 0; mocks.blocked.mockClear(); });
afterEach(() => expect(mocks.blocked).not.toHaveBeenCalled());

it("shows the installed parser's effective destination override without making a connection", () => {
  const value = base + "?host=remote.invalid";
  expect(new URL(value).hostname).toBe("127.0.0.1");
  expect(parse(value).host).toBe("remote.invalid");
  expect(parse(base + "?host=127.0.0.1&%68ost=remote.invalid").host).toBe("remote.invalid");
  expect(parse(base + "?host=remote.invalid&host=localhost").host).toBe("localhost");
  expect(mocks.pools).toHaveLength(0);
});

it.each(rejected)("rejects database destination/ambiguous query before parsing or construction: %s", query => {
  expect(() => localDatabase(environment(base + "?" + query))).toThrow("Local session unavailable.");
  expect(mocks.pools).toHaveLength(0);
});
it.each(rejected)("rejects database input before the read-only pool exists: %s", async query => {
  let reader: ReturnType<typeof openLocalSessionReader> | undefined;
  try {
    expect(() => { reader = openLocalSessionReader(environment(base + "?" + query)); }).toThrow("Local session unavailable.");
    expect(mocks.pools).toHaveLength(0);
  } finally { await reader?.close(); }
});

it.each([base, "postgres://localhost/synthetic_test", base + "?options=-c%20statement_timeout%3D1000",
  base + "?application_name=synthetic&connect_timeout=5", base + "?%61pplication_name=synthetic",
  base + "?sslmode=disable", base + "?sslmode=verify-full"])("preserves legitimate loopback destination: %s", value => {
  const accepted = localDatabase(environment(value));
  const parsed = parse(accepted.toString()); // Only approved, non-file SSL modes here.
  expect(parsed.host).toBe(accepted.hostname);
  expect(parsed.port || "5432").toBe(accepted.port || "5432");
});
it.each(["http://127.0.0.1:3000", "https://localhost:3000", "https://127.0.0.1:3001"])("keeps exact auth-origin validation: %s", origin => {
  expect(() => openLocalSessionReader({ ...environment(), BETTER_AUTH_URL: origin })).toThrow("Local session unavailable.");
  expect(mocks.pools).toHaveLength(0);
});

it.each(rejected.flatMap(query => (["session", "execution"] as const).map(kind => ({ query, kind }))))("rejects $query before the shared $kind pool is constructed", ({ query, kind }) => {
    expect(() => openLocalDatabasePool(environment(base + "?" + query), kind)).toThrow("Local session unavailable.");
    expect(mocks.pools).toHaveLength(0);
  });

it.each((["session", "execution"] as const).flatMap(kind => [base, "postgres://localhost/synthetic_test",
  base + "?%6fptions=-c%20statement_timeout%3D1000", base + "?application_name=host%3Dremote.invalid",
  base + "?sslmode=disable", base + "?sslmode=verify-full"].map(value => ({ kind, value }))))("constructs only the validated loopback $kind configuration: $value", async ({ kind, value }) => {
    const env = environment(value), pool = openLocalDatabasePool(env, kind);
    try {
      expect(mocks.pools).toHaveLength(1);
      const options = mocks.pools[0], parsed = parse(String(options.connectionString));
      expect(parsed.host).toBe(new URL(value).hostname);
      expect(options.max).toBe(kind === "session" ? 1 : 5);
      if (kind === "session") {
        expect(parsed.options).toBe("-c default_transaction_read_only=on");
        expect(options.connectionTimeoutMillis).toBe(5000);
        expect(new URL(String(options.connectionString)).searchParams.getAll("options")).toHaveLength(1);
      } else expect(parsed.options).toBe(new URL(value).searchParams.get("options") ?? undefined);
      expect(env.DATABASE_URL).toBe(value); // Never rewrite the supplied configuration.
    } finally { await pool.end(); }
  });

it("the session reader constructs only a read-only pool without validating a session or querying", async () => {
  const reader = openLocalSessionReader(environment(base + "?options=-c%20default_transaction_read_only%3Doff"));
  try {
    expect(mocks.pools).toHaveLength(1);
    expect(parse(String(mocks.pools[0].connectionString)).options).toBe("-c default_transaction_read_only=on");
  } finally { await reader.close(); }
});

it.each(["session","execution"] as const)("uses fixed diagnostic timeouts without changing the legacy %s profile",async kind=>{
  const env=environment(base+"?options=-c%20statement_timeout%3D0"),pool=openLocalDatabasePool(env,kind,true);
  try{
    const options=mocks.pools[0],parsed=parse(String(options.connectionString));
    expect(parsed.options).toBe(`${kind==="session"?"-c default_transaction_read_only=on ":""}-c statement_timeout=5000 -c lock_timeout=5000`);
    expect(options).toMatchObject({connectionTimeoutMillis:5000,query_timeout:5000});
    expect(env.DATABASE_URL).toContain("statement_timeout%3D0");
  }finally{await pool.end();}
});

it.each(["HOST=remote.invalid", "ho%00st=remote.invalid", "ho+st=remote.invalid", "options=&%6fptions=duplicate"])("rejects unknown/ambiguous decoded names deliberately: %s", query => {
    expect(() => openLocalDatabasePool(environment(base + "?" + query), "execution")).toThrow("Local session unavailable.");
    expect(mocks.pools).toHaveLength(0);
  });

it.each(["postgresql://remote.invalid/synthetic_test", "socket:/synthetic/socket", "https://127.0.0.1/synthetic_test"])("rejects a non-loopback or non-PostgreSQL authority before pool construction: %s", value => {
    expect(() => openLocalDatabasePool(environment(value), "execution")).toThrow("Local session unavailable.");
    expect(mocks.pools).toHaveLength(0);
  });
