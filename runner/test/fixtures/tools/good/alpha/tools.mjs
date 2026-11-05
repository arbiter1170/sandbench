// Test fixture tools.
const schema = { type: "object", properties: { text: { type: "string" } } };
export const tools = [
  { name: "zeta_tool", description: "Last by name.", inputSchema: schema, action: () => ({ type: "read" }), handler: async () => "z" },
  { name: "alpha_tool", description: "First by name.", inputSchema: schema, action: () => ({ type: "read" }), handler: async () => "a" },
];
