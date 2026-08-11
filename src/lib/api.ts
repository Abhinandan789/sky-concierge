export function jsonOk<T>(data: T, init?: ResponseInit) {
  return Response.json({ success: true, data }, init);
}

export function jsonError(
  message: string,
  status: number,
  code = "BAD_REQUEST",
  headers?: HeadersInit,
) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers },
  );
}
