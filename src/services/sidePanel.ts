/**
 * Side panel plumbing. Kept separate from the worker's entry point so the
 * open-on-action behaviour can be toggled from settings later.
 */

/** Make clicking the toolbar icon open the side panel instead of the popup. */
export async function setOpenOnActionClick(enabled: boolean): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: enabled })
}

/**
 * Open the side panel in the current window, from a UI surface.
 *
 * Targets `windowId` rather than `tabId` because reading the active tab needs
 * the `tabs` permission, while `chrome.windows.getCurrent` needs none — and the
 * panel is global to the window anyway. Must be called during a user gesture.
 */
export async function openInCurrentWindow(): Promise<void> {
  const current = await chrome.windows.getCurrent()
  if (typeof current.id !== 'number') {
    throw new Error('No current window to open the side panel in')
  }
  await chrome.sidePanel.open({ windowId: current.id })
}
