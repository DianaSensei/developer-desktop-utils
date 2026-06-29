// In-memory draft of the Produce form. The produce panel (and its ProduceTab,
// keyed per topic) remounts on every tab/tool/topic switch, so its fields live
// here at module scope to survive that — kept while the app is open and reset
// only when it's fully closed. Not persisted to disk (values can be large).

export interface ProduceHeader { key: string; value: string }

export const produceDraft = {
  topic: '',
  key: '',
  value: '',
  headers: [] as ProduceHeader[],
  batch: false,
  partitionMode: 'auto' as 'auto' | 'manual',
  partition: 0,
  valueFormat: 'json' as 'json' | 'plain',
};
