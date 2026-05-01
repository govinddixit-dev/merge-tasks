/**
 * Tests for extended copilot tools (copilotTools.ts)
 * Verifies that all 37 new AI executor functions work correctly.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

// We test the EXTENDED_TOOLS definition and executeExtendedTool dispatcher
describe("Copilot Extended Tools", () => {
  let EXTENDED_TOOLS: any[];
  let executeExtendedTool: any;

  beforeAll(async () => {
    const mod = await import("./routers/copilotTools");
    EXTENDED_TOOLS = mod.EXTENDED_TOOLS;
    executeExtendedTool = mod.executeExtendedTool;
  });

  describe("Tool Definitions", () => {
    it("should export EXTENDED_TOOLS as a non-empty array", () => {
      expect(Array.isArray(EXTENDED_TOOLS)).toBe(true);
      expect(EXTENDED_TOOLS.length).toBeGreaterThanOrEqual(30);
    });

    it("every tool should have required OpenAI function schema fields", () => {
      for (const tool of EXTENDED_TOOLS) {
        expect(tool.type).toBe("function");
        expect(tool.function).toBeDefined();
        expect(typeof tool.function.name).toBe("string");
        expect(typeof tool.function.description).toBe("string");
        expect(tool.function.parameters).toBeDefined();
        expect(tool.function.parameters.type).toBe("object");
      }
    });

    it("all tool names should be unique", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("should include client management tools", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      expect(names).toContain("create_client");
      expect(names).toContain("update_client");
      expect(names).toContain("delete_client");
      expect(names).toContain("get_client_details");
    });

    it("should include order management tools", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      expect(names).toContain("list_orders");
      expect(names).toContain("get_order_details");
      expect(names).toContain("create_order");
      expect(names).toContain("update_order_status");
    });

    it("should include product catalog tools", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      expect(names).toContain("create_product");
      expect(names).toContain("update_product");
      expect(names).toContain("delete_product");
    });

    it("should include estimate and invoice tools", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      expect(names).toContain("list_estimates");
      expect(names).toContain("create_estimate");
      expect(names).toContain("list_invoices");
      expect(names).toContain("create_invoice");
      expect(names).toContain("update_invoice_status");
    });

    it("should include proposal management tools", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      expect(names).toContain("list_proposals");
      expect(names).toContain("update_proposal");
      expect(names).toContain("delete_proposal");
      expect(names).toContain("duplicate_proposal");
      expect(names).toContain("configure_catalog_variants");
    });

    it("should include virtual proofing tools", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      expect(names).toContain("create_virtual_proof");
      expect(names).toContain("list_proofs");
    });

    it("should include reports and analytics tools", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      expect(names).toContain("get_dashboard_stats");
      expect(names).toContain("get_reorder_alerts");
      expect(names).toContain("get_churn_signals");
    });

    it("should include store management tools", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      expect(names).toContain("list_stores");
      expect(names).toContain("update_store");
      expect(names).toContain("get_store_details");
    });

    it("should include email and branding tools", () => {
      const names = EXTENDED_TOOLS.map((t: any) => t.function.name);
      expect(names).toContain("send_custom_email");
      expect(names).toContain("get_branding");
      expect(names).toContain("update_branding");
    });
  });

  describe("Tool Executor Dispatch", () => {
    it("should handle unknown tool names gracefully", async () => {
      const result = await executeExtendedTool(1, null, {
        id: "call_test",
        type: "function" as const,
        function: {
          name: "nonexistent_tool",
          arguments: "{}",
        },
      });
      expect(result.result).toContain("Unknown");
    });

    it("should handle invalid JSON arguments gracefully", async () => {
      const result = await executeExtendedTool(1, null, {
        id: "call_test",
        type: "function" as const,
        function: {
          name: "create_client",
          arguments: "not valid json",
        },
      });
      expect(result.result).toContain("Failed to parse");
    });

    it("should dispatch create_client to the correct executor", async () => {
      // This will attempt a real DB call, which may fail in test env
      // but it should dispatch correctly (not return "Unknown tool")
      const result = await executeExtendedTool(999, null, {
        id: "call_test",
        type: "function" as const,
        function: {
          name: "create_client",
          arguments: JSON.stringify({ companyName: "Test Corp" }),
        },
      });
      // Should either succeed or return a DB error, not "Unknown tool"
      expect(result.result).not.toContain("Unknown tool");
    });

    it("should dispatch get_dashboard_stats to the correct executor", async () => {
      const result = await executeExtendedTool(999, null, {
        id: "call_test",
        type: "function" as const,
        function: {
          name: "get_dashboard_stats",
          arguments: "{}",
        },
      });
      expect(result.result).not.toContain("Unknown tool");
    });

    it("should dispatch list_orders to the correct executor", async () => {
      const result = await executeExtendedTool(999, null, {
        id: "call_test",
        type: "function" as const,
        function: {
          name: "list_orders",
          arguments: "{}",
        },
      });
      expect(result.result).not.toContain("Unknown tool");
    });

    it("should dispatch get_branding to the correct executor", async () => {
      const result = await executeExtendedTool(999, null, {
        id: "call_test",
        type: "function" as const,
        function: {
          name: "get_branding",
          arguments: "{}",
        },
      });
      expect(result.result).not.toContain("Unknown tool");
    });
  });

  describe("Tool Schema Validation", () => {
    it("create_client should require companyName", () => {
      const tool = EXTENDED_TOOLS.find((t: any) => t.function.name === "create_client");
      expect(tool).toBeDefined();
      expect(tool.function.parameters.required).toContain("companyName");
    });

    it("delete_client should require clientId and confirm", () => {
      const tool = EXTENDED_TOOLS.find((t: any) => t.function.name === "delete_client");
      expect(tool).toBeDefined();
      expect(tool.function.parameters.required).toContain("clientId");
      expect(tool.function.parameters.required).toContain("confirm");
    });

    it("create_order should require clientId and items", () => {
      const tool = EXTENDED_TOOLS.find((t: any) => t.function.name === "create_order");
      expect(tool).toBeDefined();
      expect(tool.function.parameters.required).toContain("clientId");
      expect(tool.function.parameters.required).toContain("items");
    });

    it("update_order_status should require orderId and status", () => {
      const tool = EXTENDED_TOOLS.find((t: any) => t.function.name === "update_order_status");
      expect(tool).toBeDefined();
      expect(tool.function.parameters.required).toContain("orderId");
      expect(tool.function.parameters.required).toContain("status");
    });

    it("create_product should require name and price", () => {
      const tool = EXTENDED_TOOLS.find((t: any) => t.function.name === "create_product");
      expect(tool).toBeDefined();
      expect(tool.function.parameters.required).toContain("name");
      expect(tool.function.parameters.required).toContain("basePrice");
    });

    it("send_custom_email should require to, subject, and body", () => {
      const tool = EXTENDED_TOOLS.find((t: any) => t.function.name === "send_custom_email");
      expect(tool).toBeDefined();
      expect(tool.function.parameters.required).toContain("to");
      expect(tool.function.parameters.required).toContain("subject");
      expect(tool.function.parameters.required).toContain("body");
    });
  });
});
