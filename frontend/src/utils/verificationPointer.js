export function mapVerificationPointer(point, bounds, viewport, clamp = false) {
  const values = [point?.clientX, point?.clientY, bounds?.left, bounds?.top,
    bounds?.width, bounds?.height, viewport?.width, viewport?.height];
  if (!values.every(Number.isFinite) || [bounds.width, bounds.height, viewport.width, viewport.height].some(value => value <= 0)) return null;

  // object-fit: contain can leave padding when the remote viewport changes size.
  const scale = Math.min(bounds.width / viewport.width, bounds.height / viewport.height);
  const left = bounds.left + (bounds.width - viewport.width * scale) / 2;
  const top = bounds.top + (bounds.height - viewport.height * scale) / 2;
  const x = (point.clientX - left) / scale;
  const y = (point.clientY - top) / scale;
  if (!clamp && (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height)) return null;
  return { x: Math.max(0, Math.min(viewport.width - 1, x)), y: Math.max(0, Math.min(viewport.height - 1, y)) };
}
