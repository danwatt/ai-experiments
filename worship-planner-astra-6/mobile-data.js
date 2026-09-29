// Sample metadata only. No music notation, slide URLs, or presentation assets.
const MOBILE_ICONS = {
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2"/>',
  music:'<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  bookmark:'<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4z"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4"/>',
  church:'<path d="M3 21V10l4 2V8l5-4 5 4v4l4-2v11zM10 21v-5h4v5M12 1v5M10 3h4M11 10h2"/>',
  chevrons:'<path d="m8 9 4-4 4 4m-8 6 4 4 4-4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',down:'<path d="m7 10 5 5 5-5"/>',
  left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cloud:'<path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13 0 5 5 0 0 1 0 10M9 16l2 2 4-4"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
  upload:'<path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',play:'<path d="m9 4 12 8-12 8z" transform="translate(-2 0)"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  more:'<circle cx="5" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="19" cy="12" r=".8"/>',
  grip:'<path d="M8 5h.01M8 12h.01M8 19h.01M16 5h.01M16 12h.01M16 19h.01" stroke-width="3"/>',
  prayer:'<path d="m4 20 5-5 2-10q1-3 2 0v9l5 6M4 16l3-4m10 0 3 4M12 15l-4 6m5-6 4 6"/>',
  scripture:'<path d="M12 5v16M3 4q5-1 9 2 4-3 9-2v15q-5-1-9 2-4-3-9-2zM6 8h3m-3 4h3m6-4h3m-3 4h3"/>',
  communion:'<path d="M5 4h14v3a7 7 0 0 1-14 0zM12 14v6m-5 1h10M5 7h14"/>',
  sermon:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  'check-circle':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  slides:'<rect x="3" y="3" width="18" height="13" rx="1"/><path d="M12 16v5m-4 0h8M7 7h10m-10 4h6"/>',
  sliders:'<path d="M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2"/><circle cx="13" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  text:'<path d="M4 5h16M12 5v15m-4 0h8"/>'
};

const MOBILE_HYMNS = [
  {id:1,number:189,title:'Great Is Thy Faithfulness',author:'Thomas O. Chisholm',composer:'William M. Runyan',key:'D',meter:'11.10.11.10 with refrain',theme:'Faithfulness',verses:3,scripture:'Lamentations 3:22–23',lyrics:'Morning by morning new mercies I see',harmony:true},
  {id:2,number:225,title:'How Great Thou Art',author:'Stuart K. Hine',composer:'Swedish melody',key:'B♭',meter:'11.10.11.10 with refrain',theme:'Praise',verses:4,scripture:'Psalm 8',lyrics:'Consider all the worlds',harmony:true},
  {id:3,number:154,title:'Holy, Holy, Holy',author:'Reginald Heber',composer:'John B. Dykes',key:'E♭',meter:'11.12.12.10',theme:'Praise',verses:4,scripture:'Isaiah 6:3',lyrics:'Lord God Almighty early in the morning',harmony:true},
  {id:4,number:350,title:'When I Survey the Wondrous Cross',author:'Isaac Watts',composer:'Lowell Mason',key:'F',meter:'8.8.8.8',theme:'Communion',verses:4,scripture:'Galatians 6:14',lyrics:'On which the Prince of glory died',harmony:true},
  {id:5,number:533,title:'Just As I Am',author:'Charlotte Elliott',composer:'William B. Bradbury',key:'E♭',meter:'8.8.8.6',theme:'Invitation',verses:4,scripture:'John 6:37',lyrics:'Without one plea O Lamb of God I come',harmony:true},
  {id:6,number:601,title:'It Is Well with My Soul',author:'Horatio G. Spafford',composer:'Philip P. Bliss',key:'D',meter:'11.8.11.9 with refrain',theme:'Assurance',verses:4,scripture:'Philippians 4:7',lyrics:'When peace like a river attendeth my way',harmony:true},
  {id:7,number:456,title:'Blessed Assurance',author:'Fanny J. Crosby',composer:'Phoebe P. Knapp',key:'D',meter:'9.10.9.9 with refrain',theme:'Assurance',verses:3,scripture:'Hebrews 10:22',lyrics:'Jesus is mine foretaste of glory divine',harmony:true},
  {id:8,number:210,title:'To God Be the Glory',author:'Fanny J. Crosby',composer:'William H. Doane',key:'A♭',meter:'11.11.11.11 with refrain',theme:'Praise',verses:3,scripture:'Galatians 1:5',lyrics:'Great things he hath done',harmony:true},
  {id:9,number:318,title:'In the Sweet By and By',author:'Sanford F. Bennett',composer:'Joseph P. Webster',key:'G',meter:'9.9.9.9 with refrain',theme:'Assurance',verses:3,scripture:'John 14:2',lyrics:'There is a land that is fairer than day',harmony:true},
  {id:10,number:122,title:'Doxology',author:'Thomas Ken',composer:'Louis Bourgeois',key:'G',meter:'8.8.8.8',theme:'Praise',verses:1,scripture:'Psalm 100',lyrics:'Praise God from whom all blessings flow',harmony:true},
  {id:11,number:401,title:'Amazing Grace',author:'John Newton',composer:'Traditional American melody',key:'C',meter:'8.6.8.6',theme:'Assurance',verses:4,scripture:'Ephesians 2:8',lyrics:'How sweet the sound that saved',harmony:true},
  {id:12,number:330,title:'Break Thou the Bread of Life',author:'Mary A. Lathbury',composer:'William F. Sherwin',key:'E♭',meter:'6.4.6.4',theme:'Communion',verses:4,scripture:'John 6:35',lyrics:'Dear Lord to me as thou didst break',harmony:false}
];

const MOBILE_DEFAULT_ORDER = [
  {id:'a',type:'hymn',hymnId:3,title:'Holy, Holy, Holy',person:'James Wilson',minutes:4,section:'Opening hymn'},
  {id:'b',type:'scripture',title:'Scripture reading',person:'David Miller',minutes:3,notes:'Lamentations 3:22–26'},
  {id:'c',type:'prayer',title:'Opening prayer',person:'Robert Ellis',minutes:3},
  {id:'d',type:'hymn',hymnId:1,title:'Great Is Thy Faithfulness',person:'James Wilson',minutes:4,section:'Hymn of praise'},
  {id:'e',type:'hymn',hymnId:4,title:'When I Survey the Wondrous Cross',person:'James Wilson',minutes:4,section:'Before communion'},
  {id:'f',type:'communion',title:'The Lord’s Supper',person:'Michael Adams',minutes:8,notes:'A remembrance of Christ'},
  {id:'g',type:'sermon',title:'Faithful in Every Season',person:'Daniel Parker',minutes:22,notes:'Lamentations 3:22–26'},
  {id:'h',type:'hymn',hymnId:5,title:'Just As I Am',person:'James Wilson',minutes:4,section:'Invitation hymn'},
  {id:'i',type:'prayer',title:'Closing prayer',person:'David Miller',minutes:2}
];
