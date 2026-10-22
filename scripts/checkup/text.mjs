// 文を読む小さな部品(正規表現は使わない。Semgrep の regex_dos に当たらないように)。

/** s の at 文字目から続く数字(無ければ "") */
export function digitsAt(s, at) {
  let n = "";
  for (let i = at; i < s.length && s[i] >= "0" && s[i] <= "9"; i++) n += s[i];
  return n;
}
