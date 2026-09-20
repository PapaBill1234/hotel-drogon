/**
 * Typed escape hatches for presentational HTML attributes that the legacy PHP
 * templates emitted but React's JSX typings do not declare (`border` and
 * `align` on `<img>`, the `roomid` hook on the community room list).
 *
 * They are spread into the element rather than dropped, because the legacy
 * markup — and the `rooms.js` / `activehomes.js` scripts that read it — depend
 * on the attributes being present in the DOM.
 */

export const LEGACY_BORDER_ZERO = {
  border: '0',
} as unknown as React.ImgHTMLAttributes<HTMLImageElement>;

export const LEGACY_ALIGN_LEFT = {
  align: 'left',
} as unknown as React.ImgHTMLAttributes<HTMLImageElement>;

export function legacyRoomId(id: number): React.HTMLAttributes<HTMLSpanElement> {
  return { roomid: String(id) } as unknown as React.HTMLAttributes<HTMLSpanElement>;
}
