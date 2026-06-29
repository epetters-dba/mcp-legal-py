export function jsonContent(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function errorContent(message, extra = {}) {
  return jsonContent({
    ok: false,
    error: message,
    ...extra,
  });
}

export function successContent(payload) {
  return jsonContent({
    ok: true,
    ...payload,
  });
}
