// API-слой. Единственное место, где UI ходит на сервер. Владелец: Участник 3 (контракт - Участник 1).
// Для Dynamics 365 достаточно заменить API_BASE.
export const API_BASE = window.CQA_API_BASE || "/api";

async function request(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && data.detail;
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail || res.statusText);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request("GET", "/health"),
  importOrganizer: (group_id) => request("POST", "/import/organizer", { group_id }),
  importJson: (body) => request("POST", "/import/json", body),
  conversations: (params = {}) => request("GET", "/conversations?" + new URLSearchParams(params)),
  conversation: (id) => request("GET", "/conversations/" + encodeURIComponent(id)),
  audio: (id) => request("GET", `/conversations/${encodeURIComponent(id)}/audio`),
  checklists: () => request("GET", "/checklists"),
  checklist: (vid) => request("GET", "/checklists/" + vid),
  saveChecklist: (draft) => request("POST", "/checklists", draft),
  startEvaluation: (conversation_id, checklist_version_id) =>
    request("POST", "/evaluations", { conversation_id, checklist_version_id }),
  startBatch: (body) => request("POST", "/evaluations/batch", body),
  batches: () => request("GET", "/batches"),
  batch: (id) => request("GET", "/batches/" + id),
  batchRetry: (id) => request("POST", `/batches/${id}/retry`),
  batchCancel: (id) => request("POST", `/batches/${id}/cancel`),
  evaluation: (id) => request("GET", "/evaluations/" + id),
  exportResults: (group) => request("GET", "/export/" + encodeURIComponent(group)),
  createAppeal: (evaluationId, criterion_id, comment) =>
    request("POST", `/evaluations/${evaluationId}/appeals`, { criterion_id, comment }),
  appeals: (status) => request("GET", "/appeals" + (status ? "?status=" + status : "")),
  decide: (appealId, body) => request("POST", `/appeals/${appealId}/decision`, body),
};
