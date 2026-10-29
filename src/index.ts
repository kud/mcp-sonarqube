#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  SonarQubeClient,
  formatDate,
  formatIssueAuthor,
  formatMetricValue,
  redactToken,
  resolveConfig,
} from "@kud/sonarqube"
import { z } from "zod"

const runningUnderTest = process.env.VITEST === "true"

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

export const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
})

export const err = (msg: string) => ({
  content: [{ type: "text" as const, text: `Error: ${msg}` }],
  isError: true,
})

const getClient = () => {
  const config = resolveConfig()
  return { client: new SonarQubeClient(config), token: config.token }
}

const stripProjectPrefix = (component: string) => {
  const separator = component.indexOf(":")
  return separator === -1 ? component : component.slice(separator + 1)
}

const run = async <T>(work: (client: SonarQubeClient) => Promise<T>) => {
  let token: string | undefined
  try {
    const resolved = getClient()
    token = resolved.token
    return ok(await work(resolved.client))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err(redactToken(message, token))
  }
}

// ─── Quality gate ───

export const qualityGate = async ({
  project,
  branch,
  pullRequest,
}: {
  project: string
  branch?: string
  pullRequest?: string
}) => run((client) => client.explainGate({ project, branch, pullRequest }))

// ─── Issues ───

export const issues = async ({
  project,
  newCode,
  severities,
  types,
  statuses,
  branch,
  pullRequest,
  limit,
}: {
  project: string
  newCode?: boolean
  severities?: string[]
  types?: string[]
  statuses?: string[]
  branch?: string
  pullRequest?: string
  limit?: number
}) =>
  run(async (client) => {
    const result = await client.getIssues({
      project,
      newCode,
      severities,
      types,
      statuses,
      branch,
      pullRequest,
      limit,
    })
    return {
      project: result.projectKey,
      branch: result.branch,
      pullRequest: result.pullRequest,
      total: result.paging?.total,
      issues: result.issues.map((issue) => ({
        key: issue.key,
        file: stripProjectPrefix(issue.component),
        component: issue.component,
        line: issue.line ?? issue.textRange?.startLine,
        rule: issue.rule,
        severity: issue.severity,
        type: issue.type,
        status: issue.status,
        message: issue.message,
        author: formatIssueAuthor(issue.author),
        created: formatDate(issue.creationDate),
      })),
    }
  })

// ─── Measures ───

export const measures = async ({
  project,
  metricKeys,
  branch,
  pullRequest,
}: {
  project: string
  metricKeys: string[]
  branch?: string
  pullRequest?: string
}) =>
  run(async (client) => {
    const component = await client.getMeasures({
      project,
      metricKeys,
      branch,
      pullRequest,
    })
    if (!component) throw new Error(`no measures found for ${project}`)
    return {
      project: component.key,
      name: component.name,
      measures: component.measures.map((measure) => ({
        metric: measure.metric,
        value: formatMetricValue(measure.metric, measure.value),
      })),
    }
  })

// ─── Source ───

export const issueSource = async ({
  component,
  line,
  contextLines,
}: {
  component: string
  line: number
  contextLines?: number
}) =>
  run(async (client) => {
    const source = await client.getIssueSource(
      { component, line },
      contextLines,
    )
    if (!source?.snippet)
      throw new Error(`no source found for ${component}:${line}`)
    return {
      component,
      file: stripProjectPrefix(component),
      focus: source.focus,
      start: source.start,
      end: source.end,
      snippet: source.snippet,
    }
  })

// ─── Branches ───

export const branches = async ({ project }: { project: string }) =>
  run(async (client) => ({
    project,
    branches: (await client.getBranches(project)).map((branch) => ({
      name: branch.name,
      isMain: branch.isMain ?? false,
      type: branch.type,
      qualityGate: branch.status?.qualityGateStatus,
      analysed: formatDate(branch.analysisDate),
    })),
  }))

// ─── Projects ───

export const projects = async ({
  query,
  limit,
}: {
  query?: string
  limit?: number
}) =>
  run(async (client) => {
    const result = await client.searchProjects({ query, limit })
    return { total: result.paging?.total, projects: result.projects }
  })

const server = new McpServer({ name: "sonarqube", version: "0.1.0" })

const branchField = z.string().optional().describe("Branch name")
const pullRequestField = z.string().optional().describe("Pull request id")

server.registerTool(
  "sonarqube_quality_gate",
  {
    description:
      "Explain why a quality gate is red: status, new-code period, and conditions with the failing ones first (ratings as A-E)",
    inputSchema: {
      project: z.string().describe("Project key"),
      branch: branchField,
      pullRequest: pullRequestField,
    },
    annotations: READ_ONLY,
  },
  qualityGate,
)

server.registerTool(
  "sonarqube_issues",
  {
    description:
      "Search a project's unresolved issues with file, line, rule, severity, type, message, author and creation date",
    inputSchema: {
      project: z.string().describe("Project key"),
      newCode: z
        .boolean()
        .optional()
        .describe("Only issues in the new-code period"),
      severities: z
        .array(z.enum(["INFO", "MINOR", "MAJOR", "CRITICAL", "BLOCKER"]))
        .optional()
        .describe("Filter by severity"),
      types: z
        .array(z.enum(["CODE_SMELL", "BUG", "VULNERABILITY"]))
        .optional()
        .describe("Filter by issue type"),
      statuses: z
        .array(z.string())
        .optional()
        .describe(
          "Filter by status (OPEN, CONFIRMED, REOPENED, RESOLVED, CLOSED). Defaults to unresolved issues",
        ),
      branch: branchField,
      pullRequest: pullRequestField,
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum issues to return (default 10, max 500)"),
    },
    annotations: READ_ONLY,
  },
  issues,
)

server.registerTool(
  "sonarqube_measures",
  {
    description:
      "Read measures for a project, e.g. coverage, bugs, new_coverage, reliability_rating (ratings shown as A-E)",
    inputSchema: {
      project: z.string().describe("Project key"),
      metricKeys: z
        .array(z.string())
        .min(1)
        .describe("Metric keys, e.g. [coverage, bugs, sqale_rating]"),
      branch: branchField,
      pullRequest: pullRequestField,
    },
    annotations: READ_ONLY,
  },
  measures,
)

server.registerTool(
  "sonarqube_issue_source",
  {
    description:
      "Show the source lines around a line of a component, as returned by sonarqube_issues (component and line)",
    inputSchema: {
      component: z
        .string()
        .describe("Component key, e.g. my-project:src/index.ts"),
      line: z.number().int().min(1).describe("Line to centre the snippet on"),
      contextLines: z
        .number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("Lines of context either side (default 5)"),
    },
    annotations: READ_ONLY,
  },
  issueSource,
)

server.registerTool(
  "sonarqube_branches",
  {
    description:
      "List a project's branches with their quality gate status and last analysis date",
    inputSchema: { project: z.string().describe("Project key") },
    annotations: READ_ONLY,
  },
  branches,
)

server.registerTool(
  "sonarqube_projects",
  {
    description: "List or search projects the token can see",
    inputSchema: {
      query: z.string().optional().describe("Name or key fragment to match"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum projects to return (default 50, max 500)"),
    },
    annotations: READ_ONLY,
  },
  projects,
)

const main = async () => {
  if (!resolveConfig().host) {
    console.error(
      "SonarQube host is required: set SONAR_HOST_URL (or SONARQUBE_DASH_HOST), or `host` in the sonarqube-dash-cli config file",
    )
    process.exit(1)
  }
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("mcp-sonarqube running")
}

if (!runningUnderTest) {
  main().catch((e) => {
    console.error("Fatal:", e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
