using System.Text;

var sb = new StringBuilder();
var objects = new List<string>();
void Add(string s) => objects.Add(s);

Add("<< /Type /Catalog /Pages 2 0 R >>");
Add("<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>");
for (int i = 1; i <= 3; i++)
{
    Add($"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents {6 + i} 0 R >>");
}
Add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
string[] texts = {
    "Record Room digitization sample page one. Pension settlement verification.",
    "Estimate compliance review. Page two contains searchable text like Estimate.",
    "Audit fieldwork sample page three. Grant utilisation reconciliation.",
};
for (int i = 0; i < 3; i++)
{
    var text = texts[i];
    var stream = $"BT /F1 14 Tf 72 720 Td ({text.Replace("(", "\\(").Replace(")", "\\)")}) Tj ET";
    Add($"<< /Length {stream.Length} >>\nstream\n{stream}\nendstream");
}

var pdf = new StringBuilder();
pdf.Append("%PDF-1.4\n");
var offsets = new List<int>();
int pos = pdf.Length;
for (int i = 0; i < objects.Count; i++)
{
    offsets.Add(pos);
    pdf.Append($"{i + 1} 0 obj\n{objects[i]}\nendobj\n");
    pos = pdf.Length;
}
var xrefStart = pos;
pdf.Append($"xref\n0 {objects.Count + 1}\n");
pdf.Append("0000000000 65535 f \n");
foreach (var o in offsets) pdf.Append($"{o:D10} 00000 n \n");
pdf.Append($"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R >>\nstartxref\n{xrefStart}\n%%EOF\n");
File.WriteAllBytes(@"D:\temp\opencode\rr-sample.pdf", Encoding.Latin1.GetBytes(pdf.ToString()));
Console.WriteLine("written, bytes=" + new FileInfo(@"D:\temp\opencode\rr-sample.pdf").Length);
