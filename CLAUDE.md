# mcp-sonarqube

## API Reference

Official API docs: https://docs.sonarsource.com/sonarqube-server/latest/extension-guide/web-api/

## Architecture

Thin MCP layer over the `@kud/sonarqube` core. All HTTP, auth and config resolution live in the core; this package only validates tool input, calls `SonarQubeClient`, and shapes the output. Do not add a second HTTP client here. If a tool needs an endpoint the core lacks, add it to the core first.

Config comes from the core's `resolveConfig`: `SONARQUBE_TOKEN` / `SONAR_TOKEN` / `SONARQUBE_DASH_TOKEN` and `SONAR_HOST_URL` / `SONARQUBE_DASH_HOST`, plus the shared `sonarqube-dash-cli/config.json`. The token is never returned or logged.
