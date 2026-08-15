import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";

const MENU_PATTERN =
  `\\(0,(${NAME})\\.jsx\\)\\((${NAME}),\\{onClick:${NAME},LeftIcon:(${NAME}),children:${NAME}\\},` +
  "`sign-in-openai`\\)," +
  `t\\[\\d+\\]=${NAME},t\\[\\d+\\]=(${NAME})\\),(${NAME})\\.push\\(\\4\\)\\}(${NAME})\\.push\\(\\.\\.\\.\\5\\),`;

export default {
  id: "040-account-menu",
  description: "Account list and add-subscription entry in the profile dropdown",
  glob: "webview/assets/app-initial-*.js",
  marker: "codexpp-add-account",
  apply(source) {
    const match = matchOnce(source, MENU_PATTERN, "profil menusu");
    const [anchor, jsx, Item, Icon, , , menuItems] = match;

    const entry = (props, key) => `${menuItems}.push((0,${jsx}.jsx)(${Item},${props},\`${key}\`))`;

    const injection =
      "(()=>{" +
      "const _cxp=globalThis.__codexpp;" +
      "if(!_cxp?.accountsSync)return;" +
      "let _cxpData;try{_cxpData=_cxp.accountsSync()}catch{return}" +
      "for(const _cxpAcc of _cxpData?.accounts??[]){" +
      entry(
        `{LeftIcon:${Icon},onClick:()=>_cxp.setDefault(_cxpAcc.id),` +
          `rightIcon:_cxpAcc.id===_cxpData.defaultAccountId?(0,${jsx}.jsx)(\`span\`,{className:\`whitespace-nowrap text-codex-description\`,children:\`active\`}):null,` +
          "children:_cxpAcc.label+(_cxpAcc.planType?` · `+_cxpAcc.planType:``)}",
        "${`codexpp-account-`+_cxpAcc.id}"
      ) +
      ";}" +
      entry(
        `{LeftIcon:${Icon},onClick:()=>_cxp.addAccount(),children:\`Add another subscription\`}`,
        "codexpp-add-account"
      ) +
      ";})(),";

    return replaceOnce(source, anchor, anchor + injection);
  }
};
