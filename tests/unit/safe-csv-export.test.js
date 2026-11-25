import {test} from 'vitest';
import {csvCell,csvRow,deviceEventsFilename} from '../../safe-csv-export.js';
function buildCases(){
 const cases=[],add=(n,f)=>cases.push([n,f]),eq=(a,b)=>{if(a!==b)throw Error('assertion mismatch '+JSON.stringify([a,b]))};
 for(const prefix of ['=','+','-','@','＝','＋','－','＠'])for(const lead of ['', ' ', '\t','\u200b','\ufeff'])add('formula '+JSON.stringify(lead+prefix),()=>eq(csvCell(lead+prefix+'1'),'"'+ "'"+lead+prefix+'1"'));
 for(const value of ['\ttext','\rtext','\ntext'])add('leading control '+JSON.stringify(value),()=>eq(csvCell(value),'"'+ "'"+value+'"'));
 for(const [value,want] of [[null,'""'],[undefined,'""'],[0,'"0"'],[false,'"false"'],['ordinary','"ordinary"'],['a,b','"a,b"'],['a"b','"a""b"'],['a\nb','"a\nb"'],['a\r\nb','"a\r\nb"']])add('literal '+JSON.stringify(value),()=>eq(csvCell(value),want));
 add('CSV row retains exact columns',()=>eq(csvRow(['a,b','a"b','=1',null]),'"a,b","a""b","\'=1",""\n'));
 for(const [input,want] of [['PC-01','PC-01_events.csv'],['bad\r\nInjected: header','bad_Injected_header_events.csv'],['"../../etc"','etc_events.csv'],['','device_events.csv'],[null,'device_events.csv'],['💻','device_events.csv'],['ＡＢＣ','ABC_events.csv'],['x'.repeat(80),'x'.repeat(64)+'_events.csv']])add('filename '+JSON.stringify(input),()=>eq(deviceEventsFilename(input),want));
 return cases;
}
for(const [name,run] of buildCases())test(name,run);
