# MergeTasks Database & API Capacity Report

**Date:** April 6, 2026

This report details the results of a comprehensive stress test conducted on the MergeTasks codebase to determine if the system can support 50 distributors and their associated client data.

## 1. Executive Summary

**Yes, the codebase can comfortably support 50 distributors and their clients.** 

Following the recent architectural improvements (specifically the addition of database indexes, list pagination, and multi-tenancy enforcement), the system handles the target load with exceptional performance. The API sustains over 500 requests per second with an average response time of under 2 milliseconds, while consuming only 200 MB of RAM.

## 2. Test Methodology

To ensure realistic conditions, a custom Python script was used to seed the local MySQL database with a volume of data representing 50 highly active distributors:

*   **Distributors:** 50 users and organizations
*   **Clients:** 1,000 (20 per distributor)
*   **Products:** 1,500 (30 per distributor)
*   **Proposals:** 500 (10 per distributor)
*   **Orders:** 250 (5 per distributor)
*   **Stores:** 100 (2 per distributor)

Two distinct testing phases were executed:
1.  **Direct Database Benchmarking:** Measuring the raw execution time of the exact SQL queries used by the most critical API endpoints.
2.  **Concurrent API Load Testing:** Simulating 50 to 500 distributors making simultaneous HTTP requests to the tRPC endpoints.

## 3. Database Query Performance

Raw database query performance was measured over 20 iterations per query to establish reliable averages and 95th percentile (P95) latency.

| Query Endpoint | Scope | Avg Latency (ms) | P95 Latency (ms) |
| :--- | :--- | :--- | :--- |
| `clients.list` | Org-scoped, Limit 50 | 0.25 | 0.91 |
| `clients.list` (Search) | Org-scoped, `LIKE` filter | 0.16 | 0.21 |
| `products.list` | Org-scoped, Limit 50 | 0.47 | 0.74 |
| `proposals.list` | Org-scoped, Limit 50 | 0.23 | 0.49 |
| `stores.list` | Org-scoped | 0.17 | 0.26 |
| `orders.list` | Org-scoped, Limit 50 | 0.21 | 0.50 |
| `proposals.getById` | 4-table `LEFT JOIN` | 0.82 | 1.08 |
| Dashboard Stats | 4 `COUNT` subqueries | 0.26 | 0.39 |

**Analysis:** All critical queries execute in under 1 millisecond. The recent addition of the `(organizationId, status)` and `(organizationId, userId)` composite indexes ensures that the database engine can instantly locate the correct subset of rows without scanning the entire table.

## 4. API Concurrency & Throughput

The API layer (Express + tRPC) was tested using asynchronous HTTP requests to simulate multiple distributors accessing the system simultaneously.

### Simultaneous Load Tests

| Scenario | Concurrency | Avg Response | P95 Response | Success Rate |
| :--- | :--- | :--- | :--- | :--- |
| Dashboard Load (`clients.list`) | 50 simultaneous | 43.0 ms | 69.9 ms | 100% |
| Dashboard Load (`clients.list`) | 100 simultaneous | 144.7 ms | 242.4 ms | 100% |
| Dashboard Load (`clients.list`) | 200 simultaneous | 122.7 ms | 191.0 ms | 100% |
| Heavy Spike (`clients.list`) | 500 simultaneous | 290.2 ms | 474.0 ms | 100% |
| Mixed Usage (Clients, Products, Proposals) | 100 simultaneous | 121.1 ms | 221.9 ms | 100% |

### Maximum Throughput

A sustained throughput test was conducted to measure the absolute maximum requests per second (RPS) the Node.js server could process on a single thread.

*   **Throughput:** 576 requests per second
*   **Average Latency:** 1.7 ms
*   **P95 Latency:** 3.6 ms
*   **Success Rate:** 100%

**Analysis:** The Node.js event loop handles the concurrency efficiently. Even when 500 users hit the dashboard at the exact same millisecond, the 95th percentile response time remains under 500 milliseconds, which is imperceptible to most users.

## 5. Resource Utilization

During the stress tests, the server and database resource consumption was monitored:

*   **Node.js Process RAM:** 200.0 MB
*   **Node.js Process CPU:** ~5% (spiking to 40% during the 500-concurrency test)
*   **MySQL Slow Queries:** 0
*   **MySQL Buffer Pool Reads:** 882 (indicating excellent memory caching)

## 6. Conclusion

The MergeTasks application is highly optimized for the target scale of 50 distributors. The recent architectural changes—specifically pagination and composite indexing—have future-proofed the critical paths. 

The system will easily handle 50 distributors and could likely scale to 500+ distributors without requiring any significant changes to the database schema or server architecture.
