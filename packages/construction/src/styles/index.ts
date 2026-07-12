import { DEFAULT_STYLE } from "./default.js";import type { BuildStyle } from "./style-types.js";
const STYLES:Record<string,BuildStyle>={default:DEFAULT_STYLE,medieval:{...DEFAULT_STYLE,id:"medieval",windowSpacing:4,floorHeight:4},modern:{...DEFAULT_STYLE,id:"modern",windowSpacing:2,roofOverhang:1},rustic:{...DEFAULT_STYLE,id:"rustic",windowSpacing:3,porchDepth:3}};
export function resolveBuildStyle(id:string):{style:BuildStyle;fallback:boolean}{return STYLES[id]?{style:STYLES[id],fallback:false}:{style:DEFAULT_STYLE,fallback:true};}
export { DEFAULT_STYLE };export type { BuildStyle } from "./style-types.js";
