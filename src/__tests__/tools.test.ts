import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  branches,
  issueSource,
  issues,
  measures,
  projects,
  qualityGate,
} from "../index.js"

const TOKEN = "squ_test_secret_token"

interface Hit {
  path: string
  query: URLSearchParams
  authorization?: string
}

const hits: Hit[] = []
let server: Server
let failWith: number | undefined

const sourceFile = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join(
  "\n",
)

const routes: Record<string, (query: URLSearchParams) => unknown> = {
  "/api/qualitygates/project_status": () => ({
    projectStatus: {
      status: "ERROR",
      period: {
        mode: "PREVIOUS_VERSION",
        parameter: "1.0",
        date: "2026-01-01",
      },
      conditions: [
        {
          status: "OK",
          metricKey: "new_coverage",
          comparator: "LT",
          errorThreshold: "80",
          actualValue: "91",
        },
        {
          status: "ERROR",
          metricKey: "new_reliability_rating",
          comparator: "GT",
          errorThreshold: "1",
          actualValue: "3",
        },
      ],
    },
  }),
  "/api/issues/search": () => ({
    paging: { pageIndex: 1, pageSize: 10, total: 1 },
    issues: [
      {
        key: "AX1",
        rule: "typescript:S1234",
        severity: "MAJOR",
        type: "BUG",
        status: "OPEN",
        component: "my-project:src/app.ts",
        line: 12,
        message: "Fix this",
        author: "jane.doe@example.com",
        creationDate: "2026-03-04T10:00:00+0000",
      },
    ],
  }),
  "/api/measures/component": () => ({
    component: {
      key: "my-project",
      name: "My Project",
      measures: [
        { metric: "coverage", value: "82.5" },
        { metric: "reliability_rating", value: "2" },
      ],
    },
  }),
  "/api/sources/raw": () => sourceFile,
  "/api/project_branches/list": () => ({
    branches: [
      {
        name: "main",
        isMain: true,
        type: "LONG",
        status: { qualityGateStatus: "OK" },
        analysisDate: "2026-05-06T08:00:00+0000",
      },
    ],
  }),
  "/api/components/search": () => ({
    paging: { pageIndex: 1, pageSize: 50, total: 1 },
    components: [{ key: "my-project", name: "My Project", qualifier: "TRK" }],
  }),
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    hits.push({
      path: url.pathname,
      query: url.searchParams,
      authorization: req.headers.authorization,
    })
    const route = routes[url.pathname]
    if (failWith || !route) {
      res.statusCode = failWith ?? 404
      res.end("nope")
      return
    }
    const body = route(url.searchParams)
    if (typeof body === "string") {
      res.setHeader("content-type", "text/plain")
      res.end(body)
      return
    }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  process.env.SONAR_HOST_URL = `http://127.0.0.1:${port}`
  process.env.SONARQUBE_TOKEN = TOKEN
  process.env.XDG_CONFIG_HOME = "/nonexistent-config-home"
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  hits.length = 0
  failWith = undefined
})

const text = (result: { content: Array<{ text: string }> }) =>
  result.content[0].text
const json = (result: { content: Array<{ text: string }> }) =>
  JSON.parse(text(result))

describe("qualityGate", () => {
  it("lists failing conditions first with ratings as letters", async () => {
    const out = json(
      await qualityGate({ project: "my-project", branch: "main" }),
    )
    expect(out.status).toBe("FAILED")
    expect(out.newCodePeriod.mode).toBe("PREVIOUS_VERSION")
    expect(out.conditions[0]).toMatchObject({
      metric: "new_reliability_rating",
      failing: true,
      actual: "C",
      threshold: "A",
    })
    expect(out.conditions[1].failing).toBe(false)
    expect(hits[0].query.get("projectKey")).toBe("my-project")
    expect(hits[0].query.get("branch")).toBe("main")
  })

  it("sends the token as basic auth without leaking it", async () => {
    const result = await qualityGate({ project: "my-project" })
    const expected = Buffer.from(`${TOKEN}:`).toString("base64")
    expect(hits[0].authorization).toBe(`Basic ${expected}`)
    expect(text(result)).not.toContain(TOKEN)
  })

  it("returns an error when the server rejects the request", async () => {
    failWith = 500
    const result = await qualityGate({ project: "my-project" })
    expect(text(result)).toContain("Error:")
    expect(text(result)).toContain("500")
    expect(text(result)).not.toContain(TOKEN)
  })
})

describe("issues", () => {
  it("shapes issues with file, line, author and date", async () => {
    const out = json(
      await issues({
        project: "my-project",
        newCode: true,
        severities: ["MAJOR", "BLOCKER"],
        types: ["BUG"],
        limit: 5,
      }),
    )
    expect(out.total).toBe(1)
    expect(out.issues[0]).toMatchObject({
      key: "AX1",
      file: "src/app.ts",
      line: 12,
      rule: "typescript:S1234",
      severity: "MAJOR",
      type: "BUG",
      message: "Fix this",
      author: "jane.doe",
      created: "2026-03-04",
    })
    const query = hits[0].query
    expect(query.get("componentKeys")).toBe("my-project")
    expect(query.get("severities")).toBe("MAJOR,BLOCKER")
    expect(query.get("types")).toBe("BUG")
    expect(query.get("inNewCodePeriod")).toBe("true")
    expect(query.get("resolved")).toBe("false")
  })

  it("returns an error on failure", async () => {
    failWith = 403
    expect(text(await issues({ project: "my-project" }))).toContain("Error:")
  })
})

describe("measures", () => {
  it("returns measures with ratings as letters", async () => {
    const out = json(
      await measures({
        project: "my-project",
        metricKeys: ["coverage", "reliability_rating"],
      }),
    )
    expect(out.measures).toEqual([
      { metric: "coverage", value: "82.5" },
      { metric: "reliability_rating", value: "B" },
    ])
    expect(hits[0].query.get("metricKeys")).toBe("coverage,reliability_rating")
  })

  it("returns an error on failure", async () => {
    failWith = 404
    const result = await measures({ project: "x", metricKeys: ["bugs"] })
    expect(text(result)).toContain("Error:")
  })
})

describe("issueSource", () => {
  it("returns a snippet marking the focus line", async () => {
    const out = json(
      await issueSource({
        component: "my-project:src/app.ts",
        line: 12,
        contextLines: 2,
      }),
    )
    expect(out.file).toBe("src/app.ts")
    expect(out.start).toBe(10)
    expect(out.end).toBe(14)
    expect(out.snippet).toContain(">   12 | line 12")
    expect(hits[0].query.get("key")).toBe("my-project:src/app.ts")
  })

  it("returns an error when the source cannot be fetched", async () => {
    failWith = 404
    const result = await issueSource({
      component: "my-project:gone.ts",
      line: 1,
    })
    expect(text(result)).toContain("Error:")
  })
})

describe("branches", () => {
  it("lists branches with gate status", async () => {
    const out = json(await branches({ project: "my-project" }))
    expect(out.branches[0]).toEqual({
      name: "main",
      isMain: true,
      type: "LONG",
      qualityGate: "OK",
      analysed: "2026-05-06",
    })
  })

  it("returns an error on failure", async () => {
    failWith = 500
    expect(text(await branches({ project: "my-project" }))).toContain("Error:")
  })
})

describe("projects", () => {
  it("searches projects", async () => {
    const out = json(await projects({ query: "my" }))
    expect(out.projects[0].key).toBe("my-project")
    expect(hits[0].query.get("q")).toBe("my")
    expect(hits[0].query.get("qualifiers")).toBe("TRK")
  })

  it("returns an error on failure", async () => {
    failWith = 500
    expect(text(await projects({}))).toContain("Error:")
  })
})

describe("configuration", () => {
  it("reports a missing host as an error", async () => {
    const host = process.env.SONAR_HOST_URL
    delete process.env.SONAR_HOST_URL
    try {
      const result = await qualityGate({ project: "my-project" })
      expect(text(result)).toContain("No SonarQube host configured")
    } finally {
      process.env.SONAR_HOST_URL = host
    }
  })
})
