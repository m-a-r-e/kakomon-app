import { questionsToCsv, buildExportZip } from "../src/kakomon/export";
import { unzipSync } from "fflate";
const q = {
  id: "2023-q01", year: 2023, number: "1", category: "色彩",
  question: '曖昧な"引用"と,カンマ\n改行を含む問題文', choices: ["a","b","c","d","e"],
  answer: 3, figures: [{ id: "f1", blob: new Blob([new Uint8Array([137,80,78,71])]) }],
  note: "", sourcePageIds: ["p1"], createdAt: 0,
};
async function main() {
const zipBlob = await buildExportZip([q as any]);
const files = unzipSync(new Uint8Array(await zipBlob.arrayBuffer()));
const names = Object.keys(files).sort();
console.log("zip entries:", names);
const json = JSON.parse(new TextDecoder().decode(files["questions.json"]));
console.log("figure path in json:", json.questions[0].figures[0]);
const csv = new TextDecoder().decode(files["questions.csv"]);
console.log("csv line2 ok:", csv.split("\r\n")[1].includes('"曖昧な""引用""と,カンマ'));
if (names.length !== 3 || json.questions[0].figures[0] !== "figures/2023-q01-1.png") process.exit(1);
console.log("export test passed");
}
main();
