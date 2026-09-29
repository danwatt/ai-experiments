'use strict';
/* ------------------------------------------------------------------
   Sample data for the Selah worship planner mockup.
   Hymnal numbers, usage history and slide-pack details are illustrative.
   Lyrics are limited to public-domain text; licensed songs carry no lyrics.
------------------------------------------------------------------- */

const TODAY = new Date(2026, 8, 28); // Mon, Sep 28 2026

const HYMNALS = {
  SFP: 'Songs of Faith & Praise',
  GSC: 'Great Songs of the Church',
  HFW: 'Hymns for Worship',
  SS:  'Sacred Selections'
};

const ROLES = {
  opening:    { label: 'Opening song',    topics: ['Praise', 'Trinity', 'Worship', 'Thanksgiving'] },
  communion:  { label: 'Communion song',  topics: ['Communion', 'Cross'] },
  invitation: { label: 'Invitation song', topics: ['Invitation', 'Commitment'] },
  closing:    { label: 'Closing song',    topics: ['Commitment', 'Assurance', 'Evangelism'] },
  general:    { label: 'Song',            topics: [] }
};

const PEOPLE = [
  { id: 'dbrooks',   name: 'David Brooks',    roles: ['song', 'prayer', 'reader'] },
  { id: 'mhollis',   name: 'Mark Hollis',     roles: ['welcome', 'prayer', 'elder'] },
  { id: 'twhitaker', name: 'Tom Whitaker',    roles: ['prayer', 'reader'] },
  { id: 'kray',      name: 'Kevin Ray',       roles: ['reader', 'prayer'] },
  { id: 'jpatterson',name: 'Jim Patterson',   roles: ['elder', 'table', 'prayer'] },
  { id: 'acoleman',  name: 'Andre Coleman',   roles: ['prayer', 'table'] },
  { id: 'sortiz',    name: 'Samuel Ortiz',    roles: ['prayer', 'song'] },
  { id: 'rthompson', name: 'Ray Thompson',    roles: ['give', 'prayer'] },
  { id: 'pmaddox',   name: 'Paul Maddox',     roles: ['preacher'] },
  { id: 'wlindgren', name: 'Wes Lindgren',    roles: ['prayer', 'song'] },
  { id: 'bkessler',  name: 'Ben Kessler',     roles: ['song', 'reader'] },
  { id: 'cnguyen',   name: 'Caleb Nguyen',    roles: ['reader', 'table'] },
  { id: 'gsanders',  name: 'Greg Sanders',    roles: ['prayer', 'give'] }
];
const PERSON = Object.fromEntries(PEOPLE.map(p => [p.id, p]));
const ME = 'dbrooks';

/* ------------------------------ Hymns ------------------------------ */
const HYMNS_RAW = [
  { id: 'amazing-grace', title: 'Amazing Grace', first: 'Amazing grace! How sweet the sound',
    by: 'John Newton, 1779', music: 'Traditional American melody', tune: 'NEW BRITAIN', meter: 'C.M. (8.6.8.6)',
    key: 'G', time: '3/4', tempo: 'Moderate, ♩ = 72', start: 5, hn: { SFP: 241, GSC: 87, HFW: 62, SS: 14 },
    topics: ['Grace', 'Redemption', 'Assurance'], scr: ['Eph 2:8–9', 'Rom 5:20'], pd: 1, d: [24, 118, 290],
    sec: [['1', ['Amazing grace! How sweet the sound,', 'That saved a wretch like me!', 'I once was lost, but now am found,', 'Was blind, but now I see.']],
          ['2', ['Through many dangers, toils and snares,', 'I have already come;', '’Tis grace hath brought me safe thus far,', 'And grace will lead me home.']]] },

  { id: 'holy-holy-holy', title: 'Holy, Holy, Holy', first: 'Holy, holy, holy! Lord God Almighty!',
    by: 'Reginald Heber, 1826', music: 'John B. Dykes, 1861', tune: 'NICAEA', meter: '11.12.12.10',
    key: 'D', time: '4/4', tempo: 'Majestic, ♩ = 76', start: 3, hn: { SFP: 1, GSC: 4, HFW: 3, SS: 2 },
    topics: ['Praise', 'Trinity', 'Worship'], scr: ['Rev 4:8–11', 'Isa 6:3'], pd: 1, d: [63, 190, 330],
    sec: [['1', ['Holy, holy, holy! Lord God Almighty!', 'Early in the morning our song shall rise to Thee;', 'Holy, holy, holy! Merciful and mighty!', 'God in three Persons, blessed Trinity!']],
          ['2', ['Holy, holy, holy! All the saints adore Thee,', 'Casting down their golden crowns around the glassy sea;', 'Cherubim and seraphim falling down before Thee,', 'Which wert, and art, and evermore shalt be.']]] },

  { id: 'how-great-thou-art', title: 'How Great Thou Art', first: 'O Lord my God, when I in awesome wonder',
    by: 'Stuart K. Hine, 1949', music: 'Swedish folk melody', tune: 'O STORE GUD', meter: '11.10.11.10 with refrain',
    key: 'B♭', time: '4/4', tempo: 'Broadly, ♩ = 66', start: 5, hn: { SFP: 12, GSC: 6, HFW: 5, SS: 7 },
    topics: ['Praise', 'Worship', 'Creation'], scr: ['Ps 8:3–4', 'Ps 145:3'], pd: 0, lic: '© 1949, 1953 Stuart K. Hine · CCLI-licensed',
    d: [45, 130, 260], nv: 4 },

  { id: 'just-as-i-am', title: 'Just As I Am', first: 'Just as I am, without one plea',
    by: 'Charlotte Elliott, 1835', music: 'William B. Bradbury, 1849', tune: 'WOODWORTH', meter: 'L.M. (8.8.8.6)',
    key: 'F', time: '3/4', tempo: 'Slowly, ♩ = 60', start: 3, hn: { SFP: 547, GSC: 402, HFW: 481, SS: 398 },
    topics: ['Invitation', 'Grace', 'Commitment'], scr: ['John 6:37', 'Matt 11:28'], pd: 1, d: [1, 56, 132, 260],
    sec: [['1', ['Just as I am, without one plea,', 'But that Thy blood was shed for me,', 'And that Thou bidd’st me come to Thee,', 'O Lamb of God, I come, I come!']],
          ['2', ['Just as I am, and waiting not', 'To rid my soul of one dark blot,', 'To Thee whose blood can cleanse each spot,', 'O Lamb of God, I come, I come!']]] },

  { id: 'blessed-assurance', title: 'Blessed Assurance', first: 'Blessed assurance, Jesus is mine!',
    by: 'Fanny J. Crosby, 1873', music: 'Phoebe P. Knapp, 1873', tune: 'ASSURANCE', meter: '9.10.9.9 with refrain',
    key: 'D', time: '9/8', tempo: 'Lively, ♩. = 60', start: 3, hn: { SFP: 236, GSC: 190, HFW: 154, SS: 22 },
    topics: ['Assurance', 'Praise'], scr: ['Heb 10:22', 'Eph 1:13–14'], pd: 1, d: [9, 100, 180],
    sec: [['1', ['Blessed assurance, Jesus is mine!', 'O what a foretaste of glory divine!', 'Heir of salvation, purchase of God,', 'Born of His Spirit, washed in His blood.']],
          ['Refrain', ['This is my story, this is my song,', 'Praising my Savior all the day long;', 'This is my story, this is my song,', 'Praising my Savior all the day long.']]] },

  { id: 'great-is-thy-faithfulness', title: 'Great Is Thy Faithfulness', first: 'Great is Thy faithfulness, O God my Father',
    by: 'Thomas O. Chisholm, 1923', music: 'William M. Runyan, 1923', tune: 'FAITHFULNESS', meter: '11.10.11.10 with refrain',
    key: 'E♭', time: '4/4', tempo: 'Moderately, ♩ = 80', start: 3, hn: { SFP: 106, GSC: 45, HFW: 60, SS: 55 },
    topics: ['Praise', 'Trust', 'Thanksgiving'], scr: ['Lam 3:22–23', 'Ps 36:5'], pd: 0, lic: '© 1923, ren. 1951 Hope Publishing Co. · CCLI-licensed',
    d: [22, 78, 150], nv: 4 },

  { id: 'rock-of-ages', title: 'Rock of Ages', first: 'Rock of Ages, cleft for me',
    by: 'Augustus M. Toplady, 1776', music: 'Thomas Hastings, 1830', tune: 'TOPLADY', meter: '7.7.7.7.7.7',
    key: 'E♭', time: '4/4', tempo: 'Reverently, ♩ = 66', start: 3, hn: { SFP: 511, GSC: 262, HFW: 302, SS: 251 },
    topics: ['Cross', 'Redemption', 'Trust'], scr: ['1 Cor 10:4', 'Isa 26:4'], pd: 1, d: [88, 210],
    sec: [['1', ['Rock of Ages, cleft for me,', 'Let me hide myself in Thee;', 'Let the water and the blood,', 'From Thy wounded side which flowed,', 'Be of sin the double cure;', 'Save from wrath and make me pure.']]] },

  { id: 'nothing-but-the-blood', title: 'Nothing but the Blood', first: 'What can wash away my sin?',
    by: 'Robert Lowry, 1876', music: 'Robert Lowry, 1876', tune: 'PLAINFIELD', meter: '7.6.7.6 with refrain',
    key: 'G', time: '4/4', tempo: 'Moderate, ♩ = 92', start: 3, hn: { SFP: 439, GSC: 240, HFW: 219, SS: 221 },
    topics: ['Cross', 'Redemption', 'Communion'], scr: ['Heb 9:22', '1 John 1:7'], pd: 1, d: [35, 140],
    sec: [['1', ['What can wash away my sin?', 'Nothing but the blood of Jesus;', 'What can make me whole again?', 'Nothing but the blood of Jesus.']],
          ['Refrain', ['Oh! precious is the flow', 'That makes me white as snow;', 'No other fount I know,', 'Nothing but the blood of Jesus.']]] },

  { id: 'when-we-all-get-to-heaven', title: 'When We All Get to Heaven', first: 'Sing the wondrous love of Jesus',
    by: 'Eliza E. Hewitt, 1898', music: 'Emily D. Wilson, 1898', tune: 'HEAVEN', meter: '8.7.8.7 with refrain',
    key: 'A♭', time: '4/4', tempo: 'Joyfully, ♩ = 100', start: 5, hn: { SFP: 700, GSC: 495, HFW: 618, SS: 494 },
    topics: ['Heaven', 'Assurance'], scr: ['Rev 21:4', '1 Thess 4:17'], pd: 1, d: [70, 210],
    sec: [['1', ['Sing the wondrous love of Jesus,', 'Sing His mercy and His grace;', 'In the mansions bright and blessed', 'He’ll prepare for us a place.']],
          ['Refrain', ['When we all get to heaven,', 'What a day of rejoicing that will be!', 'When we all see Jesus,', 'We’ll sing and shout the victory!']]] },

  { id: 'softly-and-tenderly', title: 'Softly and Tenderly', first: 'Softly and tenderly Jesus is calling',
    by: 'Will L. Thompson, 1880', music: 'Will L. Thompson, 1880', tune: 'THOMPSON', meter: '11.10.11.10 with refrain',
    key: 'E♭', time: '9/8', tempo: 'Gently, ♩. = 54', start: 3, hn: { SFP: 559, GSC: 411, HFW: 496, SS: 405 },
    topics: ['Invitation'], scr: ['Matt 11:28', 'Rev 3:20'], pd: 1, d: [75, 200],
    sec: [['1', ['Softly and tenderly Jesus is calling,', 'Calling for you and for me;', 'See, on the portals He’s waiting and watching,', 'Watching for you and for me.']],
          ['Refrain', ['Come home, come home,', 'Ye who are weary, come home;', 'Earnestly, tenderly, Jesus is calling,', 'Calling, O sinner, come home!']]] },

  { id: 'o-come-all-ye-faithful', title: 'O Come, All Ye Faithful', first: 'O come, all ye faithful, joyful and triumphant',
    by: 'John F. Wade, c.1743', music: 'John F. Wade', tune: 'ADESTE FIDELES', meter: 'Irregular with refrain',
    key: 'G', time: '4/4', tempo: 'Festive, ♩ = 92', start: 1, hn: { SFP: 195, GSC: 158, HFW: 128, SS: 179 },
    topics: ['Christmas', 'Worship'], scr: ['Luke 2:15–16'], pd: 1, d: [300, 330],
    sec: [['1', ['O come, all ye faithful,', 'Joyful and triumphant,', 'O come ye, O come ye to Bethlehem;', 'Come and behold Him,', 'Born the King of angels;', 'O come, let us adore Him, Christ the Lord.']]] },

  { id: 'come-thou-fount', title: 'Come, Thou Fount of Every Blessing', first: 'Come, Thou Fount of every blessing',
    by: 'Robert Robinson, 1758', music: 'Early American melody', tune: 'NETTLETON', meter: '8.7.8.7 D',
    key: 'D', time: '4/4', tempo: 'Moderate, ♩ = 88', start: 5, hn: { SFP: 30, GSC: 37, HFW: 34, SS: 32 },
    topics: ['Praise', 'Grace', 'Guidance'], scr: ['Ps 36:9', '1 Sam 7:12'], pd: 1, d: [50, 160, 250],
    sec: [['1', ['Come, Thou Fount of every blessing,', 'Tune my heart to sing Thy grace;', 'Streams of mercy, never ceasing,', 'Call for songs of loudest praise.']],
          ['2', ['Here I raise mine Ebenezer;', 'Hither by Thy help I’m come;', 'And I hope, by Thy good pleasure,', 'Safely to arrive at home.']]] },

  { id: 'mighty-fortress', title: 'A Mighty Fortress Is Our God', first: 'A mighty fortress is our God',
    by: 'Martin Luther, 1529', music: 'Martin Luther, 1529', tune: 'EIN’ FESTE BURG', meter: '8.7.8.7.6.6.6.6.7',
    key: 'C', time: '4/4', tempo: 'Firmly, ♩ = 84', start: 3, hn: { SFP: 43, GSC: 20, HFW: 15, SS: 18 },
    topics: ['Trust', 'Worship'], scr: ['Ps 46:1', 'Ps 18:2'], pd: 1, d: [170, 340],
    sec: [['1', ['A mighty fortress is our God,', 'A bulwark never failing;', 'Our Helper He, amid the flood', 'Of mortal ills prevailing.']]] },

  { id: 'it-is-well', title: 'It Is Well with My Soul', first: 'When peace, like a river, attendeth my way',
    by: 'Horatio G. Spafford, 1873', music: 'Philip P. Bliss, 1876', tune: 'VILLE DU HAVRE', meter: '11.8.11.9 with refrain',
    key: 'D♭', time: '4/4', tempo: 'Reflectively, ♩ = 72', start: 3, hn: { SFP: 353, GSC: 283, HFW: 213, SS: 210 },
    topics: ['Trust', 'Comfort', 'Assurance'], scr: ['Phil 4:7', 'Job 1:21'], pd: 1, d: [40, 120],
    sec: [['1', ['When peace, like a river, attendeth my way,', 'When sorrows like sea billows roll;', 'Whatever my lot, Thou hast taught me to say,', 'It is well, it is well with my soul.']],
          ['Refrain', ['It is well (it is well),', 'With my soul (with my soul),', 'It is well, it is well with my soul.']]] },

  { id: 'abide-with-me', title: 'Abide with Me', first: 'Abide with me; fast falls the eventide',
    by: 'Henry F. Lyte, 1847', music: 'William H. Monk, 1861', tune: 'EVENTIDE', meter: '10.10.10.10',
    key: 'E♭', time: '4/4', tempo: 'Slowly, ♩ = 60', start: 3, hn: { SFP: 2, GSC: 1, HFW: 1, SS: 1 },
    topics: ['Comfort', 'Prayer'], scr: ['Luke 24:29'], pd: 1, d: [110, 240],
    sec: [['1', ['Abide with me; fast falls the eventide;', 'The darkness deepens; Lord, with me abide;', 'When other helpers fail and comforts flee,', 'Help of the helpless, O abide with me.']]] },

  { id: 'be-thou-my-vision', title: 'Be Thou My Vision', first: 'Be Thou my Vision, O Lord of my heart',
    by: 'Ancient Irish; tr. Mary E. Byrne, 1905', music: 'Irish folk melody', tune: 'SLANE', meter: '10.10.9.10',
    key: 'E♭', time: '3/4', tempo: 'Flowing, ♩ = 76', start: 5, hn: { SFP: 84, GSC: 94, HFW: 71, SS: 88 },
    topics: ['Guidance', 'Commitment', 'Prayer'], scr: ['Ps 119:105', 'Prov 3:5–6'], pd: 1, d: [95, 200],
    sec: [['1', ['Be Thou my Vision, O Lord of my heart;', 'Naught be all else to me, save that Thou art;', 'Thou my best Thought, by day or by night,', 'Waking or sleeping, Thy presence my light.']]] },

  { id: 'are-you-washed', title: 'Are You Washed in the Blood?', first: 'Have you been to Jesus for the cleansing power?',
    by: 'Elisha A. Hoffman, 1878', music: 'Elisha A. Hoffman, 1878', tune: 'WASHED IN THE BLOOD', meter: '11.10.11.10 with refrain',
    key: 'F', time: '4/4', tempo: 'Moderate, ♩ = 88', start: 3, hn: { SFP: 402, GSC: 264, HFW: 299, SS: 252 },
    topics: ['Cross', 'Redemption', 'Invitation'], scr: ['Rev 7:14', '1 John 1:7'], pd: 1, d: [180, 300],
    sec: [['1', ['Have you been to Jesus for the cleansing power?', 'Are you washed in the blood of the Lamb?', 'Are you fully trusting in His grace this hour?', 'Are you washed in the blood of the Lamb?']],
          ['Refrain', ['Are you washed in the blood,', 'In the soul-cleansing blood of the Lamb?', 'Are your garments spotless? Are they white as snow?', 'Are you washed in the blood of the Lamb?']]] },

  { id: 'i-surrender-all', title: 'I Surrender All', first: 'All to Jesus I surrender',
    by: 'Judson W. Van DeVenter, 1896', music: 'Winfield S. Weeden, 1896', tune: 'SURRENDER', meter: '8.7.8.7 with refrain',
    key: 'E♭', time: '4/4', tempo: 'Earnestly, ♩ = 80', start: 3, hn: { SFP: 559, GSC: 405, HFW: 483, SS: 400 },
    topics: ['Commitment', 'Invitation'], scr: ['Luke 14:33', 'Rom 12:1'], pd: 1, d: [60, 150],
    sec: [['1', ['All to Jesus I surrender;', 'All to Him I freely give;', 'I will ever love and trust Him,', 'In His presence daily live.']],
          ['Refrain', ['I surrender all, I surrender all,', 'All to Thee, my blessed Savior,', 'I surrender all.']]] },

  { id: 'trust-and-obey', title: 'Trust and Obey', first: 'When we walk with the Lord in the light of His Word',
    by: 'John H. Sammis, 1887', music: 'Daniel B. Towner, 1887', tune: 'TRUST AND OBEY', meter: '6.6.9.D with refrain',
    key: 'G', time: '4/4', tempo: 'Brightly, ♩ = 96', start: 5, hn: { SFP: 596, GSC: 425, HFW: 449, SS: 421 },
    topics: ['Obedience', 'Trust', 'Commitment'], scr: ['John 14:15', '1 Sam 15:22'], pd: 1, d: [15, 90, 200, 280],
    sec: [['1', ['When we walk with the Lord in the light of His Word,', 'What a glory He sheds on our way!', 'While we do His good will, He abides with us still,', 'And with all who will trust and obey.']],
          ['Refrain', ['Trust and obey, for there’s no other way', 'To be happy in Jesus, but to trust and obey.']]] },

  { id: 'what-a-friend', title: 'What a Friend We Have in Jesus', first: 'What a Friend we have in Jesus',
    by: 'Joseph M. Scriven, 1855', music: 'Charles C. Converse, 1868', tune: 'CONVERSE', meter: '8.7.8.7 D',
    key: 'F', time: '4/4', tempo: 'Gently, ♩ = 76', start: 5, hn: { SFP: 655, GSC: 456, HFW: 391, SS: 452 },
    topics: ['Prayer', 'Comfort'], scr: ['Phil 4:6', '1 Pet 5:7'], pd: 1, d: [130, 270],
    sec: [['1', ['What a Friend we have in Jesus,', 'All our sins and griefs to bear!', 'What a privilege to carry', 'Everything to God in prayer!']]] },

  { id: 'take-my-life', title: 'Take My Life and Let It Be', first: 'Take my life, and let it be',
    by: 'Frances R. Havergal, 1874', music: 'Henri A. C. Malan, 1827', tune: 'HENDON', meter: '7.7.7.7',
    key: 'G', time: '4/4', tempo: 'Sincerely, ♩ = 80', start: 3, hn: { SFP: 606, GSC: 351, HFW: 423, SS: 351 },
    topics: ['Commitment', 'Prayer'], scr: ['Rom 12:1'], pd: 1, d: [200, 350],
    sec: [['1', ['Take my life, and let it be', 'Consecrated, Lord, to Thee;', 'Take my hands, and let them move', 'At the impulse of Thy love.']]] },

  { id: 'in-the-garden', title: 'In the Garden', first: 'I come to the garden alone',
    by: 'C. Austin Miles, 1912', music: 'C. Austin Miles, 1912', tune: 'GARDEN', meter: '9.9.9.9 with refrain',
    key: 'A♭', time: '4/4', tempo: 'Gently, ♩ = 76', start: 3, hn: { SFP: 350, GSC: 254, HFW: 290, SS: 241 },
    topics: ['Comfort', 'Prayer'], scr: ['John 20:16'], pd: 1, d: [220, 330],
    sec: [['1', ['I come to the garden alone,', 'While the dew is still on the roses;', 'And the voice I hear falling on my ear', 'The Son of God discloses.']],
          ['Refrain', ['And He walks with me, and He talks with me,', 'And He tells me I am His own;', 'And the joy we share as we tarry there,', 'None other has ever known.']]] },

  { id: 'leaning', title: 'Leaning on the Everlasting Arms', first: 'What a fellowship, what a joy divine',
    by: 'Elisha A. Hoffman, 1887', music: 'Anthony J. Showalter, 1887', tune: 'SHOWALTER', meter: '10.9.10.9 with refrain',
    key: 'A♭', time: '4/4', tempo: 'Warmly, ♩ = 84', start: 3, hn: { SFP: 397, GSC: 268, HFW: 305, SS: 261 },
    topics: ['Trust', 'Comfort', 'Assurance'], scr: ['Deut 33:27'], pd: 1, d: [65, 190],
    sec: [['1', ['What a fellowship, what a joy divine,', 'Leaning on the everlasting arms;', 'What a blessedness, what a peace is mine,', 'Leaning on the everlasting arms.']],
          ['Refrain', ['Leaning, leaning, safe and secure from all alarms;', 'Leaning, leaning, leaning on the everlasting arms.']]] },

  { id: 'he-leadeth-me', title: 'He Leadeth Me', first: 'He leadeth me: O blessed thought!',
    by: 'Joseph H. Gilmore, 1862', music: 'William B. Bradbury, 1864', tune: 'HE LEADETH ME', meter: 'L.M. with refrain',
    key: 'F', time: '4/4', tempo: 'Moderate, ♩ = 80', start: 3, hn: { SFP: 393, GSC: 272, HFW: 302, SS: 267 },
    topics: ['Guidance', 'Trust'], scr: ['Ps 23:2–3'], pd: 1, d: [100, 250],
    sec: [['1', ['He leadeth me: O blessed thought!', 'O words with heavenly comfort fraught!', 'Whate’er I do, where’er I be,', 'Still ’tis God’s hand that leadeth me.']],
          ['Refrain', ['He leadeth me, He leadeth me,', 'By His own hand He leadeth me;', 'His faithful follower I would be,', 'For by His hand He leadeth me.']]] },

  { id: 'when-i-survey', title: 'When I Survey the Wondrous Cross', first: 'When I survey the wondrous cross',
    by: 'Isaac Watts, 1707', music: 'Lowell Mason, 1824', tune: 'HAMBURG', meter: 'L.M. (8.8.8.8)',
    key: 'G', time: '4/4', tempo: 'Solemnly, ♩ = 66', start: 3, hn: { SFP: 271, GSC: 215, HFW: 138, SS: 132 },
    topics: ['Communion', 'Cross'], scr: ['Gal 6:14', '1 Cor 11:26'], pd: 1, d: [180, 400],
    sec: [['1', ['When I survey the wondrous cross', 'On which the Prince of glory died,', 'My richest gain I count but loss,', 'And pour contempt on all my pride.']],
          ['2', ['Forbid it, Lord, that I should boast,', 'Save in the death of Christ, my God;', 'All the vain things that charm me most,', 'I sacrifice them to His blood.']]] },

  { id: 'there-is-a-fountain', title: 'There Is a Fountain', first: 'There is a fountain filled with blood',
    by: 'William Cowper, 1772', music: 'Early American melody; arr. Lowell Mason', tune: 'CLEANSING FOUNTAIN', meter: 'C.M.D. (8.6.8.6 D)',
    key: 'B♭', time: '4/4', tempo: 'Reverently, ♩ = 72', start: 5, hn: { SFP: 264, GSC: 228, HFW: 143, SS: 140 },
    topics: ['Communion', 'Cross', 'Redemption'], scr: ['Zech 13:1', 'Heb 9:14'], pd: 1, d: [52, 165],
    sec: [['1', ['There is a fountain filled with blood', 'Drawn from Immanuel’s veins;', 'And sinners plunged beneath that flood', 'Lose all their guilty stains.']],
          ['2', ['The dying thief rejoiced to see', 'That fountain in his day;', 'And there may I, though vile as he,', 'Wash all my sins away.']]] },

  { id: 'beneath-the-cross', title: 'Beneath the Cross of Jesus', first: 'Beneath the cross of Jesus I fain would take my stand',
    by: 'Elizabeth C. Clephane, 1868', music: 'Frederick C. Maker, 1881', tune: 'ST. CHRISTOPHER', meter: '7.6.8.6.8.6.8.6',
    key: 'F', time: '4/4', tempo: 'Slowly, ♩ = 66', start: 3, hn: { SFP: 273, GSC: 224, HFW: 141, SS: 137 },
    topics: ['Communion', 'Cross'], scr: ['Isa 32:2'], pd: 1, d: [140, 320],
    sec: [['1', ['Beneath the cross of Jesus', 'I fain would take my stand,', 'The shadow of a mighty Rock', 'Within a weary land;']]] },

  { id: 'jesus-paid-it-all', title: 'Jesus Paid It All', first: 'I hear the Savior say, "Thy strength indeed is small"',
    by: 'Elvina M. Hall, 1865', music: 'John T. Grape, 1868', tune: 'ALL TO CHRIST', meter: '6.6.7.7 with refrain',
    key: 'E♭', time: '4/4', tempo: 'Moderate, ♩ = 76', start: 3, hn: { SFP: 275, GSC: 233, HFW: 145, SS: 147 },
    topics: ['Cross', 'Redemption', 'Communion', 'Grace'], scr: ['Isa 53:5', '1 Pet 1:18–19'], pd: 1, d: [30, 110],
    sec: [['1', ['I hear the Savior say,', '“Thy strength indeed is small;', 'Child of weakness, watch and pray,', 'Find in Me thine all in all.”']],
          ['Refrain', ['Jesus paid it all,', 'All to Him I owe;', 'Sin had left a crimson stain,', 'He washed it white as snow.']]] },

  { id: 'o-sacred-head', title: 'O Sacred Head, Now Wounded', first: 'O sacred Head, now wounded',
    by: 'Bernard of Clairvaux; tr. J. W. Alexander', music: 'Hans L. Hassler; harm. J. S. Bach', tune: 'PASSION CHORALE', meter: '7.6.7.6 D',
    key: 'E♭', time: '4/4', tempo: 'Solemnly, ♩ = 60', start: 3, hn: { SFP: 260, GSC: 219, HFW: 133, SS: 128 },
    topics: ['Communion', 'Cross'], scr: ['Isa 53:3–5', 'John 19:2'], pd: 1, d: [200, 400],
    sec: [['1', ['O sacred Head, now wounded,', 'With grief and shame weighed down,', 'Now scornfully surrounded', 'With thorns, Thine only crown:']]] },

  { id: 'let-us-break-bread', title: 'Let Us Break Bread Together', first: 'Let us break bread together on our knees',
    by: 'African-American spiritual', music: 'African-American spiritual', tune: 'BREAK BREAD', meter: 'Irregular',
    key: 'F', time: '4/4', tempo: 'Slowly, ♩ = 56', start: 3, hn: { SFP: 267, GSC: 213 },
    topics: ['Communion'], scr: ['Acts 2:42', '1 Cor 10:16'], pd: 1, d: [150, 330],
    sec: [['1', ['Let us break bread together on our knees,', 'Let us break bread together on our knees;', 'When I fall on my knees, with my face to the rising sun,', 'O Lord, have mercy on me.']]] },

  { id: 'why-do-you-wait', title: 'Why Do You Wait?', first: 'Why do you wait, dear brother',
    by: 'George F. Root, 1868', music: 'George F. Root, 1868', tune: 'WHY DO YOU WAIT', meter: '11.8.11.8 with refrain',
    key: 'F', time: '4/4', tempo: 'Moderate, ♩ = 92', start: 5, hn: { SFP: 568, GSC: 439, HFW: 467, SS: 430 },
    topics: ['Invitation', 'Obedience'], scr: ['Acts 22:16', 'Acts 2:38'], pd: 1, d: [44, 170, 300],
    sec: [['1', ['Why do you wait, dear brother,', 'Oh, why do you tarry so long?', 'Your Savior is waiting to give you', 'A place in His sanctified throng.']],
          ['Refrain', ['Why not, why not, why not come to Him now?']]] },

  { id: 'almost-persuaded', title: 'Almost Persuaded', first: 'Almost persuaded, now to believe',
    by: 'Philip P. Bliss, 1871', music: 'Philip P. Bliss, 1871', tune: 'ALMOST PERSUADED', meter: '8.7.8.7 D',
    key: 'E♭', time: '6/8', tempo: 'Earnestly, ♩. = 56', start: 3, hn: { SFP: 526, GSC: 393, HFW: 419, SS: 384 },
    topics: ['Invitation'], scr: ['Acts 26:28'], pd: 1, d: [120, 290],
    sec: [['1', ['“Almost persuaded,” now to believe;', '“Almost persuaded,” Christ to receive;', 'Seems now some soul to say,', '“Go, Spirit, go Thy way,', 'Some more convenient day', 'On Thee I’ll call.”']]] },

  { id: 'i-am-resolved', title: 'I Am Resolved', first: 'I am resolved no longer to linger',
    by: 'Palmer Hartsough, 1896', music: 'James H. Fillmore, 1896', tune: 'RESOLVED', meter: '11.9.11.9 with refrain',
    key: 'E♭', time: '4/4', tempo: 'Brightly, ♩ = 96', start: 5, hn: { SFP: 581, GSC: 388, HFW: 445, SS: 381 },
    topics: ['Commitment', 'Invitation'], scr: ['Josh 24:15'], pd: 1, d: [130, 260],
    sec: [['1', ['I am resolved no longer to linger,', 'Charmed by the world’s delight;', 'Things that are higher, things that are nobler,', 'These have allured my sight.']],
          ['Refrain', ['I will hasten to Him, hasten so glad and free;', 'Jesus, greatest, highest, I will come to Thee.']]] },

  { id: 'o-happy-day', title: 'O Happy Day', first: 'O happy day, that fixed my choice',
    by: 'Philip Doddridge, 1755', music: 'Edward F. Rimbault, 1854', tune: 'HAPPY DAY', meter: 'L.M. with refrain',
    key: 'F', time: '4/4', tempo: 'Joyfully, ♩ = 104', start: 3, hn: { SFP: 478, GSC: 335, HFW: 352, SS: 320 },
    topics: ['Baptism', 'Commitment', 'Invitation'], scr: ['Rom 6:3–4', 'Col 2:12'], pd: 1, d: [200, 350],
    sec: [['1', ['O happy day, that fixed my choice', 'On Thee, my Saviour and my God!', 'Well may this glowing heart rejoice,', 'And tell its raptures all abroad.']],
          ['Refrain', ['Happy day, happy day,', 'When Jesus washed my sins away!']]] },

  { id: 'churchs-one-foundation', title: 'The Church’s One Foundation', first: 'The Church’s one foundation is Jesus Christ her Lord',
    by: 'Samuel J. Stone, 1866', music: 'Samuel S. Wesley, 1864', tune: 'AURELIA', meter: '7.6.7.6 D',
    key: 'E♭', time: '4/4', tempo: 'Steadily, ♩ = 80', start: 5, hn: { SFP: 612, GSC: 370, HFW: 392, SS: 366 },
    topics: ['Church', 'Baptism', 'Unity'], scr: ['1 Cor 3:11', 'Eph 5:26'], pd: 1, d: [85, 260],
    sec: [['1', ['The Church’s one foundation', 'Is Jesus Christ her Lord;', 'She is His new creation', 'By water and the word:']]] },

  { id: 'joy-to-the-world', title: 'Joy to the World', first: 'Joy to the world! the Lord is come',
    by: 'Isaac Watts, 1719', music: 'George F. Handel; arr. Lowell Mason', tune: 'ANTIOCH', meter: 'C.M. (8.6.8.6)',
    key: 'D', time: '4/4', tempo: 'Joyfully, ♩ = 112', start: 5, hn: { SFP: 190, GSC: 152, HFW: 118, SS: 172 },
    topics: ['Christmas', 'Praise'], scr: ['Luke 2:10–11', 'Ps 98:4'], pd: 1, d: [300, 345],
    sec: [['1', ['Joy to the world! the Lord is come;', 'Let earth receive her King;', 'Let every heart prepare Him room,', 'And heaven and nature sing.']]] },

  { id: 'silent-night', title: 'Silent Night', first: 'Silent night, holy night',
    by: 'Joseph Mohr, 1818', music: 'Franz X. Gruber, 1818', tune: 'STILLE NACHT', meter: 'Irregular',
    key: 'B♭', time: '6/8', tempo: 'Gently, ♩. = 54', start: 5, hn: { SFP: 209, GSC: 166, HFW: 134, SS: 188 },
    topics: ['Christmas'], scr: ['Luke 2:8–14'], pd: 1, d: [305, 340],
    sec: [['1', ['Silent night, holy night!', 'All is calm, all is bright', 'Round yon virgin mother and Child.', 'Holy Infant, so tender and mild,', 'Sleep in heavenly peace,', 'Sleep in heavenly peace.']]] },

  { id: 'hark-the-herald', title: 'Hark! The Herald Angels Sing', first: 'Hark! the herald angels sing',
    by: 'Charles Wesley, 1739', music: 'Felix Mendelssohn, 1840', tune: 'MENDELSSOHN', meter: '7.7.7.7 D with refrain',
    key: 'F', time: '4/4', tempo: 'Brightly, ♩ = 100', start: 5, hn: { SFP: 187, GSC: 148, HFW: 116, SS: 168 },
    topics: ['Christmas', 'Praise'], scr: ['Luke 2:13–14'], pd: 1, d: [302, 340],
    sec: [['1', ['Hark! the herald angels sing,', '“Glory to the newborn King;', 'Peace on earth, and mercy mild,', 'God and sinners reconciled!”']]] },

  { id: 'away-in-a-manger', title: 'Away in a Manger', first: 'Away in a manger, no crib for a bed',
    by: 'Anonymous, 1885', music: 'William J. Kirkpatrick, 1895', tune: 'CRADLE SONG', meter: '11.11.11.11',
    key: 'F', time: '3/4', tempo: 'Tenderly, ♩ = 66', start: 5, hn: { SFP: 192, GSC: 157, HFW: 125 },
    topics: ['Christmas'], scr: ['Luke 2:7'], pd: 1, d: [310],
    sec: [['1', ['Away in a manger, no crib for a bed,', 'The little Lord Jesus laid down His sweet head;', 'The stars in the bright sky looked down where He lay,', 'The little Lord Jesus, asleep on the hay.']]] },

  { id: 'doxology', title: 'Praise God, from Whom All Blessings Flow', first: 'Praise God, from whom all blessings flow',
    by: 'Thomas Ken, 1674', music: 'Attr. Louis Bourgeois, 1551', tune: 'OLD HUNDREDTH', meter: 'L.M. (8.8.8.8)',
    key: 'G', time: '4/4', tempo: 'Broadly, ♩ = 80', start: 5, hn: { SFP: 3, GSC: 7, HFW: 4, SS: 6 },
    topics: ['Praise', 'Thanksgiving', 'Trinity', 'Worship'], scr: ['Ps 100', 'Jas 1:17'], pd: 1, d: [35, 280],
    sec: [['1', ['Praise God, from whom all blessings flow;', 'Praise Him, all creatures here below;', 'Praise Him above, ye heavenly host;', 'Praise Father, Son, and Holy Ghost. Amen.']]] },

  { id: 'all-hail-the-power', title: 'All Hail the Power of Jesus’ Name', first: 'All hail the power of Jesus’ name!',
    by: 'Edward Perronet, 1779', music: 'Oliver Holden, 1793', tune: 'CORONATION', meter: 'C.M. with repeat',
    key: 'G', time: '4/4', tempo: 'Majestically, ♩ = 92', start: 5, hn: { SFP: 20, GSC: 26, HFW: 22, SS: 20 },
    topics: ['Praise', 'Worship'], scr: ['Phil 2:9–11', 'Rev 19:16'], pd: 1, d: [55, 200],
    sec: [['1', ['All hail the power of Jesus’ name!', 'Let angels prostrate fall;', 'Bring forth the royal diadem,', 'And crown Him Lord of all.']]] },

  { id: 'crown-him', title: 'Crown Him with Many Crowns', first: 'Crown Him with many crowns',
    by: 'Matthew Bridges, 1851', music: 'George J. Elvey, 1868', tune: 'DIADEMATA', meter: 'S.M.D. (6.6.8.6 D)',
    key: 'D', time: '4/4', tempo: 'Triumphantly, ♩ = 92', start: 5, hn: { SFP: 292, GSC: 88, HFW: 23, SS: 90 },
    topics: ['Praise', 'Worship', 'Resurrection'], scr: ['Rev 19:12', 'Rev 5:12'], pd: 1, d: [140, 320],
    sec: [['1', ['Crown Him with many crowns,', 'The Lamb upon His throne;', 'Hark! how the heavenly anthem drowns', 'All music but its own!']]] },

  { id: 'old-rugged-cross', title: 'The Old Rugged Cross', first: 'On a hill far away stood an old rugged cross',
    by: 'George Bennard, 1913', music: 'George Bennard, 1913', tune: 'OLD RUGGED CROSS', meter: '12.8.12.8 with refrain',
    key: 'A♭', time: '3/4', tempo: 'Slowly, ♩ = 66', start: 3, hn: { SFP: 282, GSC: 246, HFW: 148, SS: 236 },
    topics: ['Cross', 'Communion'], scr: ['Gal 6:14', '1 Cor 1:18'], pd: 1, d: [42, 155, 270],
    sec: [['1', ['On a hill far away stood an old rugged cross,', 'The emblem of suffering and shame;', 'And I love that old cross where the dearest and best', 'For a world of lost sinners was slain.']],
          ['Refrain', ['So I’ll cherish the old rugged cross,', 'Till my trophies at last I lay down;', 'I will cling to the old rugged cross,', 'And exchange it some day for a crown.']]] },

  { id: 'revive-us-again', title: 'Revive Us Again', first: 'We praise Thee, O God! for the Son of Thy love',
    by: 'William P. Mackay, 1863', music: 'John J. Husband, 1815', tune: 'HALLELUJAH', meter: '11.11 with refrain',
    key: 'A♭', time: '4/4', tempo: 'Lively, ♩ = 100', start: 5, hn: { SFP: 496, GSC: 336, HFW: 353, SS: 322 },
    topics: ['Praise', 'Commitment'], scr: ['Ps 85:6'], pd: 1, d: [95, 240],
    sec: [['1', ['We praise Thee, O God! for the Son of Thy love,', 'For Jesus who died, and is now gone above.']],
          ['Refrain', ['Hallelujah! Thine the glory! Hallelujah! Amen!', 'Hallelujah! Thine the glory! Revive us again.']]] },

  { id: 'standing-on-the-promises', title: 'Standing on the Promises', first: 'Standing on the promises of Christ my King',
    by: 'R. Kelso Carter, 1886', music: 'R. Kelso Carter, 1886', tune: 'PROMISES', meter: '11.11.11.9 with refrain',
    key: 'B♭', time: '4/4', tempo: 'Brightly, ♩ = 104', start: 5, hn: { SFP: 615, GSC: 407, HFW: 445, SS: 402 },
    topics: ['Trust', 'Word'], scr: ['2 Pet 1:4', '2 Cor 1:20'], pd: 1, d: [38, 170],
    sec: [['1', ['Standing on the promises of Christ my King,', 'Through eternal ages let His praises ring;', 'Glory in the highest, I will shout and sing,', 'Standing on the promises of God.']],
          ['Refrain', ['Standing, standing,', 'Standing on the promises of God my Savior;', 'Standing, standing,', 'I’m standing on the promises of God.']]] },

  { id: 'to-god-be-the-glory', title: 'To God Be the Glory', first: 'To God be the glory! great things He hath done!',
    by: 'Fanny J. Crosby, 1875', music: 'William H. Doane, 1875', tune: 'TO GOD BE THE GLORY', meter: '11.11.11.11 with refrain',
    key: 'A♭', time: '4/4', tempo: 'Joyfully, ♩ = 104', start: 5, hn: { SFP: 25, GSC: 31, HFW: 26, SS: 26 },
    topics: ['Praise', 'Grace'], scr: ['John 3:16', 'Rom 11:36'], pd: 1, d: [58, 175],
    sec: [['1', ['To God be the glory! great things He hath done!', 'So loved He the world that He gave us His Son,', 'Who yielded His life an atonement for sin,', 'And opened the life-gate that all may go in.']],
          ['Refrain', ['Praise the Lord, praise the Lord,', 'Let the earth hear His voice!', 'Praise the Lord, praise the Lord,', 'Let the people rejoice!']]] },

  { id: 'wonderful-words', title: 'Wonderful Words of Life', first: 'Sing them over again to me',
    by: 'Philip P. Bliss, 1874', music: 'Philip P. Bliss, 1874', tune: 'WORDS OF LIFE', meter: '8.8.8.8 with refrain',
    key: 'F', time: '4/4', tempo: 'Moderate, ♩ = 92', start: 3, hn: { SFP: 620, GSC: 454, HFW: 469, SS: 440 },
    topics: ['Word'], scr: ['John 6:68', 'Ps 119:105'], pd: 1, d: [160, 330],
    sec: [['1', ['Sing them over again to me,', 'Wonderful words of life;', 'Let me more of their beauty see,', 'Wonderful words of life;']],
          ['Refrain', ['Beautiful words, wonderful words,', 'Wonderful words of life;', 'Beautiful words, wonderful words,', 'Wonderful words of life.']]] },

  { id: 'rescue-the-perishing', title: 'Rescue the Perishing', first: 'Rescue the perishing, care for the dying',
    by: 'Fanny J. Crosby, 1869', music: 'William H. Doane, 1870', tune: 'RESCUE', meter: '11.10.11.10 with refrain',
    key: 'E♭', time: '4/4', tempo: 'Earnestly, ♩ = 88', start: 5, hn: { SFP: 588, GSC: 455, HFW: 520, SS: 448 },
    topics: ['Evangelism'], scr: ['Luke 19:10', 'Jude 22–23'], pd: 1, d: [190, 340],
    sec: [['1', ['Rescue the perishing, care for the dying,', 'Snatch them in pity from sin and the grave;', 'Weep o’er the erring one, lift up the fallen,', 'Tell them of Jesus, the mighty to save.']],
          ['Refrain', ['Rescue the perishing, care for the dying;', 'Jesus is merciful, Jesus will save.']]] },

  { id: 'come-ye-thankful', title: 'Come, Ye Thankful People, Come', first: 'Come, ye thankful people, come',
    by: 'Henry Alford, 1844', music: 'George J. Elvey, 1858', tune: 'ST. GEORGE’S WINDSOR', meter: '7.7.7.7 D',
    key: 'E♭', time: '4/4', tempo: 'Broadly, ♩ = 88', start: 5, hn: { SFP: 183, GSC: 143, HFW: 108, SS: 158 },
    topics: ['Thanksgiving', 'Praise'], scr: ['Ps 107:1', 'Col 3:15'], pd: 1, d: [340],
    sec: [['1', ['Come, ye thankful people, come,', 'Raise the song of harvest home;', 'All is safely gathered in,', 'Ere the winter storms begin;']]] },

  { id: 'in-christ-alone', title: 'In Christ Alone', first: 'In Christ alone my hope is found',
    by: 'Keith Getty & Stuart Townend, 2001', music: 'Keith Getty & Stuart Townend', tune: 'IN CHRIST ALONE', meter: '8.7.8.7 D',
    key: 'D', time: '3/4', tempo: 'Steadily, ♩ = 76', start: 5, hn: { SFP: 780, HFW: 690 },
    topics: ['Cross', 'Assurance', 'Resurrection'], scr: ['Gal 6:14', 'Rom 8:38–39'], pd: 0, lic: '© 2001 Thankyou Music · CCLI-licensed',
    d: [20, 70, 150], nv: 4 },

  { id: 'ten-thousand-reasons', title: '10,000 Reasons (Bless the Lord)', first: 'Bless the Lord, O my soul',
    by: 'Matt Redman & Jonas Myrin, 2011', music: 'Matt Redman & Jonas Myrin', tune: '10,000 REASONS', meter: 'Irregular',
    key: 'G', time: '4/4', tempo: 'Moderate, ♩ = 73', start: 5, hn: { SFP: 802 },
    topics: ['Praise', 'Thanksgiving', 'Worship'], scr: ['Ps 103:1–2'], pd: 0, lic: '© 2011 Atlas Mountain Songs et al. · CCLI-licensed',
    d: [10, 45, 90], nv: 3, pending: true }
];

/* --------------------------- Derived fields --------------------------- */
const HYMNS = HYMNS_RAW.map(h => {
  h.d = h.d || [];
  h.last = h.d.length ? Math.min(...h.d) : null;
  h.cnt = h.d.filter(x => x < 365).length;
  if (!h.sec) h.sec = Array.from({ length: h.nv || 3 }, (_, i) => [String(i + 1), null]);
  h.slides = h.sec.length;
  h.lyrics = h.sec.map(s => (s[1] || []).join(' ')).join(' ');
  return h;
});
const HYMN = Object.fromEntries(HYMNS.map(h => [h.id, h]));
const ALL_TOPICS = [...new Set(HYMNS.flatMap(h => h.topics))].sort();

/* ------------------------------ Services ------------------------------ */
let _uid = 0;
const nid = () => 'i' + (++_uid);
const item = (type, title, who, extra = {}) => ({ id: nid(), type, title, who: who || null, ...extra });
const song = (hymn, role, who = 'dbrooks', extra = {}) =>
  item('song', hymn ? HYMN[hymn].title : ROLES[role].label, who,
       { hymn, role, verses: hymn ? HYMN[hymn].sec.map((_, i) => i) : [], shift: 0, ...extra });

const SERVICES = [
  {
    id: 's1', kind: 'Sunday Morning', title: 'Sunday Morning Worship', date: '2026-10-04', status: 'draft',
    theme: 'Grace', text: 'Ephesians 2:1–10',
    items: [
      Object.assign(item('welcome', 'Welcome & Announcements', 'mhollis', { notes: 'Visitors card, benevolence update, Wednesday night class change.' }), { section: 'Gathering' }),
      Object.assign(song('holy-holy-holy', 'opening', 'dbrooks', { notes: 'Start softly, build in v2.' }), { section: 'Gathering' }),
      Object.assign(item('prayer', 'Opening Prayer', 'twhitaker', { notes: 'Thanks for the Lord’s day; those who are sick or traveling.' }), { section: 'Gathering' }),
      Object.assign(song('come-thou-fount', 'general'), { section: 'Gathering' }),
      Object.assign(song('blessed-assurance', 'general'), { section: 'Gathering' }),
      Object.assign(item('scripture', 'Scripture Reading', 'kray', { ref: 'Psalm 103:1–14' }), { section: 'Gathering' }),

      Object.assign(song('when-i-survey', 'communion'), { section: 'The Lord’s Supper' }),
      Object.assign(item('supper', 'Communion Thoughts', 'jpatterson', { ref: '1 Corinthians 11:23–29' }), { section: 'The Lord’s Supper' }),
      Object.assign(item('prayer', 'Prayer for the Bread', 'acoleman'), { section: 'The Lord’s Supper' }),
      Object.assign(item('prayer', 'Prayer for the Fruit of the Vine', 'sortiz'), { section: 'The Lord’s Supper' }),
      Object.assign(song('there-is-a-fountain', 'communion', 'dbrooks', { notes: 'Sung while the emblems are served.' }), { section: 'The Lord’s Supper' }),

      Object.assign(item('give', 'Contribution', 'rthompson', { notes: 'Prayer, then collectors come forward.' }), { section: 'Giving' }),

      Object.assign(song('trust-and-obey', 'general'), { section: 'The Word' }),
      Object.assign(item('sermon', 'The Sufficiency of Grace', 'pmaddox', { ref: 'Ephesians 2:1–10', notes: 'Series: Ephesians (Part 4).' }), { section: 'The Word' }),

      Object.assign(song(null, 'invitation', 'dbrooks'), { section: 'Response' }),
      Object.assign(item('prayer', 'Closing Prayer', 'wlindgren'), { section: 'Response' })
    ]
  },
  {
    id: 's2', kind: 'Sunday Evening', title: 'Sunday Evening Worship', date: '2026-10-04', status: 'draft',
    theme: '', text: '1 Peter 1:3–9',
    items: [
      Object.assign(song('great-is-thy-faithfulness', 'opening', 'sortiz'), { section: 'Gathering' }),
      Object.assign(item('prayer', 'Opening Prayer', 'gsanders'), { section: 'Gathering' }),
      Object.assign(song('leaning', 'general', 'sortiz'), { section: 'Gathering' }),
      Object.assign(item('sermon', 'Living Hope', 'pmaddox', { ref: '1 Peter 1:3–9' }), { section: 'The Word' }),
      Object.assign(song(null, 'invitation', 'sortiz'), { section: 'Response' }),
      Object.assign(item('prayer', 'Closing Prayer', 'cnguyen'), { section: 'Response' })
    ]
  },
  {
    id: 's3', kind: 'Wednesday Bible Class', title: 'Wednesday Evening', date: '2026-10-07', status: 'draft',
    theme: '', text: 'Acts 2',
    items: [
      Object.assign(song('what-a-friend', 'opening', 'bkessler'), { section: 'Gathering' }),
      Object.assign(item('prayer', 'Opening Prayer', 'kray'), { section: 'Gathering' }),
      Object.assign(item('custom', 'Bible Class: The Early Church', 'pmaddox', { ref: 'Acts 2:42–47' }), { section: 'Class' }),
      Object.assign(song('take-my-life', 'closing', 'bkessler'), { section: 'Response' }),
      Object.assign(item('prayer', 'Closing Prayer', 'twhitaker'), { section: 'Response' })
    ]
  },
  {
    id: 's4', kind: 'Sunday Morning', title: 'Sunday Morning Worship', date: '2026-10-11', status: 'draft',
    theme: '', text: '',
    items: [
      Object.assign(song(null, 'opening'), { section: 'Gathering' }),
      Object.assign(item('prayer', 'Opening Prayer', null), { section: 'Gathering' }),
      Object.assign(song(null, 'general'), { section: 'Gathering' }),
      Object.assign(song(null, 'communion'), { section: 'The Lord’s Supper' }),
      Object.assign(item('supper', 'Communion Thoughts', null), { section: 'The Lord’s Supper' }),
      Object.assign(item('give', 'Contribution', null), { section: 'Giving' }),
      Object.assign(item('sermon', 'Sermon', 'pmaddox'), { section: 'The Word' }),
      Object.assign(song(null, 'invitation'), { section: 'Response' }),
      Object.assign(item('prayer', 'Closing Prayer', null), { section: 'Response' })
    ]
  },
  {
    id: 's0', kind: 'Sunday Morning', title: 'Sunday Morning Worship', date: '2026-09-27', status: 'done',
    theme: 'Grace', text: 'Ephesians 1:3–14',
    items: [
      Object.assign(song('all-hail-the-power', 'opening', 'dbrooks'), { section: 'Gathering' }),
      Object.assign(item('prayer', 'Opening Prayer', 'kray'), { section: 'Gathering' }),
      Object.assign(song('nothing-but-the-blood', 'communion'), { section: 'The Lord’s Supper' }),
      Object.assign(item('supper', 'Communion Thoughts', 'jpatterson'), { section: 'The Lord’s Supper' }),
      Object.assign(item('sermon', 'Blessed in Christ', 'pmaddox', { ref: 'Ephesians 1:3–14' }), { section: 'The Word' }),
      Object.assign(song('just-as-i-am', 'invitation'), { section: 'Response' }),
      Object.assign(item('prayer', 'Closing Prayer', 'twhitaker'), { section: 'Response' })
    ]
  }
];
