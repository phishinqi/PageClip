# PageClip Chrome Web Store listing

## Product

- Name: PageClip
- Homepage: https://phishinqi.github.io/PageClip/
- Privacy policy: https://phishinqi.github.io/PageClip/privacy.html
- Terms of service: https://phishinqi.github.io/PageClip/terms.html
- Support: https://github.com/phishinqi/PageClip/issues
- Release package: release/PageClip-v1.6.5.zip

## 1.6.5 hotfix release notes

- Fixed a crash when opening or editing collection items with existing or newly added tags.
- Preserved tag entry with Enter, English comma, and Chinese comma, plus duplicate prevention and the 12-tag limit.

## 1.6.4 release notes

- Fixed recursive folder counts and parent-folder browsing for nested collections.
- Unified folder row click and Space-key expand/collapse behavior across collection and Chrome bookmark trees.
- Renamed Custom ordering to Manual order and fixed collection item editing/tag chips.
- Fixed folder count alignment and made the folder rail width drag smoother.
- Virtualized large collection lists so folders with around 1,400 saved pages remain responsive.

## Short description

中文：本地优先的 Chrome 侧边栏收藏、快捷收藏夹、Inbox 与加密 Google Drive 备份工具。

English: A local-first Chrome sidebar for bookmarks, quick access, Inbox, and encrypted Google Drive backups。

## Detailed description

PageClip keeps your browser workflow organized without mixing permanent bookmarks, temporary reading items, quick tab collections, and Chrome native bookmarks into one list. Save pages to a local-first collection, add folders, tags, and notes, preserve quick tab groups, use a 30-day recycle bin, manually or automatically back up the complete PageClip data set to Google Drive after client-side encryption, and browse retained backup history.

PageClip does not modify Chrome bookmarks when importing or restoring PageClip cloud data. Google Drive backups are encrypted before upload, and PageClip does not operate a separate application server, advertising system, or analytics tracker.

## Permission justifications

- bookmarks: read and manage Chrome native bookmarks in the dedicated Chrome Bookmarks view; browser bookmark import is copy-only when importing.
- tabs: read the active tab or current window tab URLs and titles for collection, Inbox, and quick tab collection actions.
- storage: store PageClip data locally in chrome.storage.local.
- favicon: display website favicons.
- contextMenus: expose PageClip actions from the browser context menu.
- tabGroups: preserve Chrome tab group metadata in quick collections.
- scripting: inject the PageClip web sidebar bridge on ordinary http/https pages.
- identity: authenticate the user with Google for an explicitly requested cloud backup or restore.
- identity.email: display the connected Google account in the settings page.
- readingList (optional): only after permission is granted, integrate with Chrome Reading List; PageClip Inbox remains independent.

## Data use

PageClip uses data only to provide the user-requested collection, bookmark, Inbox, Reading List, local storage, and encrypted backup features. It does not sell data, use data for advertising, creditworthiness, price evaluation, or behavioral profiling.
