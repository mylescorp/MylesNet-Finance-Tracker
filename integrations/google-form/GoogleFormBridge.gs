/**
 * Companion Google Apps Script bridge for the existing accountant form.
 * Add this file to the Sheet's Apps Script project and run
 * installGoogleFormBridgeTriggers_ only after staging parity is approved.
 * The existing onEntrySubmit/doPost handlers are not replaced.
 */

const GOOGLE_FORM_QUEUE_TAB_ = 'Google_Form_Sync_Queue';
const GOOGLE_FORM_URL_PROP_ = 'GOOGLE_FORM_INGRESS_URL';

function installGoogleFormBridgeTriggers_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the workbook before installing the bridge.');
  let queue = ss.getSheetByName(GOOGLE_FORM_QUEUE_TAB_);
  if (!queue) {
    queue = ss.insertSheet(GOOGLE_FORM_QUEUE_TAB_);
    queue.getRange(1, 1, 1, 6).setValues([['Source key', 'Payload', 'State', 'Attempts', 'Updated at', 'Last result']]);
    queue.hideSheet();
  }
  const triggers = ScriptApp.getProjectTriggers();
  if (!triggers.some(trigger => trigger.getHandlerFunction() === 'queueGoogleFormSubmission_')) {
    ScriptApp.newTrigger('queueGoogleFormSubmission_').forSpreadsheet(ss).onFormSubmit().create();
  }
  if (!triggers.some(trigger => trigger.getHandlerFunction() === 'flushGoogleFormQueue_')) {
    ScriptApp.newTrigger('flushGoogleFormQueue_').timeBased().everyMinutes(5).create();
  }
}

function queueGoogleFormSubmission_(event) {
  if (!event || !event.namedValues || !event.range) throw new Error('Expected a spreadsheet form-submit event.');
  const ss = event.range.getSheet().getParent();
  const sheet = event.range.getSheet();
  const sourceKey = [ss.getId(), sheet.getSheetId(), event.range.getRow()].join(':');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const queue = ss.getSheetByName(GOOGLE_FORM_QUEUE_TAB_);
    if (!queue) throw new Error('Google Form queue is missing. Run the bridge setup first.');
    const existing = queue.createTextFinder(sourceKey).matchEntireCell(true).findNext();
    if (existing) return;
    const payload = normalizeGoogleFormSubmission_(sourceKey, event.namedValues);
    queue.appendRow([sourceKey, JSON.stringify(payload), 'pending', 0, new Date(), '']);
  } finally { lock.releaseLock(); }
}

function normalizeGoogleFormSubmission_(sourceKey, namedValues) {
  const fields = {};
  Object.keys(namedValues).forEach(key => {
    if (String(key).toLowerCase() === 'email address') return;
    const value = namedValues[key];
    fields[String(key).trim()] = Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
  });
  const selection = String(fields['What are you recording?'] || '').toLowerCase();
  const kind = selection.includes('sales') ? 'sale'
    : selection.includes('expense') ? 'expense'
    : selection.includes('movement') || selection.includes('money') ? 'movement'
    : selection.includes('saving') || selection.includes('investment') ? 'savings'
    : selection.includes('loan') ? 'loan' : 'unknown';
  const dateField = kind === 'sale' ? 'Sales date' : kind === 'expense' ? 'Expense date'
    : kind === 'movement' ? 'Movement date' : kind === 'savings' ? 'Investment date' : 'Due date';
  const emailValue = namedValues['Email address'];
  const submittedByEmail = Array.isArray(emailValue) ? String(emailValue[0] || '').trim() : String(emailValue || '').trim();
  return { sourceKey, kind, occurredOn: googleFormDay_(fields[dateField]), submittedByEmail, fields };
}

function googleFormDay_(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parts = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (parts) {
    const locale = Session.getActiveUserLocale().toLowerCase();
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const month = locale.startsWith('en_us') ? first : second;
    const day = locale.startsWith('en_us') ? second : first;
    const candidate = new Date(Number(parts[3]), month - 1, day);
    if (candidate.getFullYear() === Number(parts[3]) && candidate.getMonth() === month - 1 && candidate.getDate() === day) {
      return Utilities.formatDate(candidate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function flushGoogleFormQueue_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const queue = ss && ss.getSheetByName(GOOGLE_FORM_QUEUE_TAB_);
  const endpoint = PropertiesService.getScriptProperties().getProperty(GOOGLE_FORM_URL_PROP_);
  if (!queue || !endpoint) return;
  const lastRow = queue.getLastRow();
  if (lastRow < 2) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let tasks;
  try {
    tasks = queue.getRange(2, 1, lastRow - 1, 6).getValues()
      .map((row, index) => ({ row: index + 2, sourceKey: row[0], payload: row[1], state: row[2], attempts: row[3] }))
      .filter(row => row.state === 'pending' || row.state === 'retry').slice(0, 10);
  } finally { lock.releaseLock(); }
  tasks.forEach(task => {
      const { row: targetRow, payload, state, attempts } = task;
      let result = 'retry';
      let nextState = 'retry';
      try {
        const response = UrlFetchApp.fetch(endpoint.replace(/\?token=[A-Fa-f0-9]{64}$/, ''), {
          method: 'post', contentType: 'application/json', payload: String(payload), muteHttpExceptions: true,
          headers: { Authorization: 'Bearer ' + getGoogleFormToken_(endpoint) },
        });
        const code = response.getResponseCode();
        const body = JSON.parse(response.getContentText() || '{}');
        result = String(body.status || `http_${code}`).slice(0, 80);
        if (code >= 200 && code < 300 && ['posted', 'needs_review', 'duplicate'].includes(body.status)) nextState = body.status === 'needs_review' ? 'needs_review' : 'delivered';
      } catch (error) {
        result = error && error.message ? String(error.message).slice(0, 80) : 'delivery_failed';
      }
      lock.waitLock(20000);
      try {
        const currentState = queue.getRange(targetRow, 3).getValue();
        if (currentState === state) queue.getRange(targetRow, 3, 1, 4).setValues([[nextState, Number(attempts || 0) + 1, new Date(), result]]);
      } finally { lock.releaseLock(); }
  });
}

function configureGoogleFormIngressUrl_() {
  if (typeof checkPermission === 'function' && !checkPermission('MANAGE_USERS')) return;
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('Connect Google Form to MylesNet', 'Paste the private connection URL copied from Settings → Data. The URL contains a secret; do not share it.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  setGoogleFormIngressUrl_(answer.getResponseText().trim());
  ui.alert('Connection URL saved in Script Properties.');
}

function setGoogleFormIngressUrl_(url) {
  if (!/^https:\/\/.+\.convex\.site\/google-form\?token=[A-Fa-f0-9]{64}$/.test(String(url || ''))) throw new Error('Enter the private Convex Google Form URL copied from Settings → Data.');
  PropertiesService.getScriptProperties().setProperty(GOOGLE_FORM_URL_PROP_, String(url));
}

function getGoogleFormToken_(url) {
  const match = String(url || '').match(/[?&]token=([A-Fa-f0-9]{64})$/);
  if (!match) throw new Error('Google Form ingress URL is missing its private connection key.');
  return match[1];
}
