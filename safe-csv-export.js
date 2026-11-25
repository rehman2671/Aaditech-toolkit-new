// CSV quoting is not sufficient to prevent spreadsheet formula execution.
export function csvCell(value){
 let s=value==null?'':String(value);
 // Spreadsheet formula protection even after whitespace/control characters.
 // Preserve the original text, but force dangerous text to be interpreted as text.
 if(/^[\s\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]*[=+\-@\uff1d\uff0b\uff0d\uff20]/u.test(s)||/^[\t\r\n]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
export function csvRow(values){return values.map(csvCell).join(',')+'\n'}
export function deviceEventsFilename(hostname){
 const s=String(hostname??'').normalize('NFKC').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64);
 return (s||'device')+'_events.csv';
}
