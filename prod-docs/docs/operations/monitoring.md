# Production Monitoring

This document details the monitoring strategy for JIDIS production systems.

## 1. Metrics & Dashboards
We use Prometheus & Grafana for system metrics.
- **Host Metrics:** CPU, RAM, Disk I/O via Node Exporter.
- **Container Metrics:** CPU, Memory limits via cAdvisor.
- **Application Metrics:** Request rates, latency, and error rates exported from the BFF and Microservices.

## 2. Centralized Logging
Logs from all containers are forwarded to a centralized ELK (Elasticsearch, Logstash, Kibana) or Datadog stack.
- Query logs by `service_name`, `trace_id`, or `level`.
- Alerts are triggered automatically for `ERROR` level logs exceeding defined thresholds.

## 3. APM (Application Performance Monitoring)
Trace requests across microservices.
- Ensure every incoming request at the BFF generates a `X-Trace-Id` header.
- This ID must be passed down to the Auth and Data services for unified trace visualization.

## 4. Alerting Rules
Critical alerts are routed to the on-call engineer via PagerDuty/Slack:
- **API Availability:** BFF `/health` endpoint is down for > 2 minutes.
- **High Error Rate:** > 5% of API requests return 5xx errors over 5 minutes.
- **Database Load:** PostgreSQL CPU utilization > 85% for > 15 minutes.
- **Disk Space:** Database volume < 15% free space remaining.
