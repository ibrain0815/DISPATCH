using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Microsoft.CSharp;
using Newtonsoft.Json;

namespace RevitMCP
{
    // ─────────────────────────────────────────────
    // 1. ExternalEvent 핸들러 — Revit API 스레드에서 실행
    // ─────────────────────────────────────────────
    public class RevitCommandHandler : IExternalEventHandler
    {
        public Action<UIApplication> Action { get; set; }
        public object Result { get; set; }
        public Exception Error  { get; set; }

        private readonly ManualResetEventSlim _done = new ManualResetEventSlim(false);

        public void Execute(UIApplication app)
        {
            _done.Reset();
            Error  = null;
            Result = null;
            try   { Action?.Invoke(app); }
            catch (Exception ex) { Error = ex; }
            finally { _done.Set(); }
        }

        public string GetName() => "RevitMCP Handler";

        public object Run(ExternalEvent ev, Action<UIApplication> action, int timeoutMs = 15000)
        {
            Action = action;
            _done.Reset();
            ev.Raise();
            bool ok = _done.Wait(timeoutMs);
            if (!ok)           throw new TimeoutException("Revit API 응답 시간 초과");
            if (Error != null)  throw Error;
            return Result;
        }
    }

    // ─────────────────────────────────────────────
    // 2. IExternalApplication — 애드인 진입점
    // ─────────────────────────────────────────────
    public class RevitMCPApp : IExternalApplication
    {
        private HttpListener        _listener;
        private Thread              _listenerThread;
        private RevitCommandHandler _handler;
        private ExternalEvent       _externalEvent;

        public static RevitMCPApp Instance { get; private set; }

        public Result OnStartup(UIControlledApplication app)
        {
            Instance       = this;
            _handler       = new RevitCommandHandler();
            _externalEvent = ExternalEvent.Create(_handler);

            StartHttpServer();
            TaskDialog.Show("RevitMCP", "MCP 서버가 시작되었습니다.\nhttp://localhost:8765");
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            _listener?.Stop();
            return Result.Succeeded;
        }

        // ── HTTP 서버 ──────────────────────────────
        private void StartHttpServer()
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add("http://localhost:8765/");
            _listener.Start();

            _listenerThread = new Thread(Listen) { IsBackground = true };
            _listenerThread.Start();
        }

        private void Listen()
        {
            while (_listener.IsListening)
            {
                try
                {
                    var ctx = _listener.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));
                }
                catch { /* 서버 종료 시 무시 */ }
            }
        }

        private void HandleRequest(HttpListenerContext ctx)
        {
            string body = "";
            if (ctx.Request.HasEntityBody)
                using (var r = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
                    body = r.ReadToEnd();

            string path     = ctx.Request.Url.AbsolutePath;
            string response = Route(path, body);

            byte[] buf = Encoding.UTF8.GetBytes(response);
            ctx.Response.ContentType     = "application/json; charset=utf-8";
            ctx.Response.ContentLength64 = buf.Length;
            ctx.Response.OutputStream.Write(buf, 0, buf.Length);
            ctx.Response.OutputStream.Close();
        }

        // ── 라우터 ────────────────────────────────
        private string Route(string path, string body)
        {
            try
            {
                switch (path)
                {
                    case "/ping":           return Ok(new { status = "ok", version = "1.0" });
                    case "/project/info":   return RunRevit(app => GetProjectInfo(app.ActiveUIDocument.Document));
                    case "/levels":         return RunRevit(app => GetLevels(app.ActiveUIDocument.Document));
                    case "/elements":       return RunRevit(app => GetElements(app.ActiveUIDocument.Document, body));
                    case "/element/info":   return RunRevit(app => GetElementInfo(app.ActiveUIDocument.Document, body));
                    case "/element/params": return RunRevit(app => GetElementParams(app.ActiveUIDocument.Document, body));
                    case "/create/level":   return RunRevit(app => CreateLevel(app.ActiveUIDocument.Document, body));
                    case "/create/wall":    return RunRevit(app => CreateWall(app.ActiveUIDocument.Document, body));
                    case "/create/floor":   return RunRevit(app => CreateFloor(app.ActiveUIDocument.Document, body));
                    case "/create/column":  return RunRevit(app => CreateColumn(app.ActiveUIDocument.Document, body));
                    case "/set/color":      return RunRevit(app => SetElementColor(app.ActiveUIDocument, body));
                    case "/run":            return RunRevit(app => RunScript(app.ActiveUIDocument, body));
                    case "/set/param":      return RunRevit(app => SetParameter(app.ActiveUIDocument.Document, body));
                    case "/delete/element": return RunRevit(app => DeleteElement(app.ActiveUIDocument.Document, body));
                    default:                return MakeError($"알 수 없는 경로: {path}");
                }
            }
            catch (Exception ex)
            {
                return MakeError(ex.Message);
            }
        }

        private string RunRevit(Action<UIApplication> action)
        {
            object result = null;
            _handler.Run(_externalEvent, app =>
            {
                _handler.Result = null;
                action(app);
                result = _handler.Result;
            });
            return result as string ?? Ok(new { status = "done" });
        }

        // ── API 핸들러 ────────────────────────────

        private void GetProjectInfo(Document doc)
        {
            var info = doc.ProjectInformation;
            _handler.Result = Ok(new
            {
                name       = doc.Title,
                path       = doc.PathName,
                number     = info.Number,
                address    = info.Address,
                client     = info.ClientName,
                status     = info.Status,
                isModified = doc.IsModified
            });
        }

        private void GetLevels(Document doc)
        {
            var levels = new FilteredElementCollector(doc)
                .OfClass(typeof(Level))
                .Cast<Level>()
                .ToList();

            var list = new List<object>();
            foreach (var l in levels)
                list.Add(new { id = l.Id.Value, name = l.Name, elevation = l.Elevation });

            _handler.Result = Ok(new { count = list.Count, levels = list });
        }

        private void GetElements(Document doc, string body)
        {
            var req     = JsonConvert.DeserializeObject<Dictionary<string, string>>(body)
                          ?? new Dictionary<string, string>();
            string cat  = DictGet(req, "category", "OST_Walls");
            bool typeOnly = DictGet(req, "type", "false") == "true";

            if (!Enum.TryParse<BuiltInCategory>(cat, out var bic))
                throw new ArgumentException($"알 수 없는 카테고리: {cat}");

            var col = new FilteredElementCollector(doc).OfCategory(bic);
            col = typeOnly ? col.WhereElementIsElementType() : col.WhereElementIsNotElementType();

            var list = new List<object>();
            foreach (var e in col.ToElements())
                list.Add(new { id = e.Id.Value, name = e.Name, category = e.Category?.Name });

            _handler.Result = Ok(new { count = list.Count, elements = list });
        }

        private void GetElementInfo(Document doc, string body)
        {
            var req = JsonConvert.DeserializeObject<Dictionary<string, int>>(body)
                      ?? new Dictionary<string, int>();
            var el  = doc.GetElement(new ElementId(req["id"]));
            if (el == null) throw new Exception("요소를 찾을 수 없습니다.");

            _handler.Result = Ok(new
            {
                id       = el.Id.Value,
                name     = el.Name,
                category = el.Category?.Name,
                typeId   = el.GetTypeId().Value,
                levelId  = (el as FamilyInstance)?.LevelId?.Value
            });
        }

        private void GetElementParams(Document doc, string body)
        {
            var req = JsonConvert.DeserializeObject<Dictionary<string, int>>(body)
                      ?? new Dictionary<string, int>();
            var el  = doc.GetElement(new ElementId(req["id"]));
            if (el == null) throw new Exception("요소를 찾을 수 없습니다.");

            var paramList = new List<object>();
            foreach (Parameter p in el.Parameters)
            {
                string val;
                switch (p.StorageType)
                {
                    case StorageType.String:    val = p.AsString(); break;
                    case StorageType.Double:    val = p.AsDouble().ToString("F4"); break;
                    case StorageType.Integer:   val = p.AsInteger().ToString(); break;
                    case StorageType.ElementId: val = p.AsElementId().Value.ToString(); break;
                    default:                    val = ""; break;
                }
                paramList.Add(new
                {
                    name     = p.Definition.Name,
                    value    = val,
                    readOnly = p.IsReadOnly,
                    type     = p.StorageType.ToString()
                });
            }

            _handler.Result = Ok(new { id = el.Id.Value, parameters = paramList });
        }

        private void CreateLevel(Document doc, string body)
        {
            var req   = JsonConvert.DeserializeObject<Dictionary<string, object>>(body)
                        ?? new Dictionary<string, object>();
            double elev = Convert.ToDouble(DictGet(req, "elevation", (object)0));
            string name = DictGet(req, "name", (object)"New Level")?.ToString();

            double elevFt = UnitUtils.ConvertToInternalUnits(elev, UnitTypeId.Meters);

            using (var t = new Transaction(doc, "MCP: 레벨 생성"))
            {
                t.Start();
                var level  = Level.Create(doc, elevFt);
                level.Name = name;
                t.Commit();
                _handler.Result = Ok(new { id = level.Id.Value, name = level.Name, elevation = elev });
            }
        }

        private void CreateWall(Document doc, string body)
        {
            var req = JsonConvert.DeserializeObject<Dictionary<string, object>>(body)
                      ?? new Dictionary<string, object>();

            double x1 = Convert.ToDouble(DictGet(req, "x1", (object)0));
            double y1 = Convert.ToDouble(DictGet(req, "y1", (object)0));
            double x2 = Convert.ToDouble(DictGet(req, "x2", (object)5));
            double y2 = Convert.ToDouble(DictGet(req, "y2", (object)0));
            double h  = Convert.ToDouble(DictGet(req, "height", (object)3));

            var line = Line.CreateBound(new XYZ(x1, y1, 0), new XYZ(x2, y2, 0));

            var wallType = new FilteredElementCollector(doc)
                .OfClass(typeof(WallType)).Cast<WallType>().First();
            var level = new FilteredElementCollector(doc)
                .OfClass(typeof(Level)).Cast<Level>().First();

            double hFt = UnitUtils.ConvertToInternalUnits(h, UnitTypeId.Meters);

            using (var t = new Transaction(doc, "MCP: 벽 생성"))
            {
                t.Start();
                var wall = Wall.Create(doc, line, wallType.Id, level.Id, hFt, 0, false, false);
                t.Commit();
                _handler.Result = Ok(new { id = wall.Id.Value, name = wall.Name });
            }
        }

        private void CreateFloor(Document doc, string body)
        {
            var req = JsonConvert.DeserializeObject<Dictionary<string, object>>(body)
                      ?? new Dictionary<string, object>();

            double w = Convert.ToDouble(DictGet(req, "width", (object)10));
            double d = Convert.ToDouble(DictGet(req, "depth", (object)8));

            var pts = new[] {
                new XYZ(0, 0, 0), new XYZ(w, 0, 0),
                new XYZ(w, d, 0), new XYZ(0, d, 0)
            };

            var loop = new CurveLoop();
            for (int i = 0; i < pts.Length; i++)
                loop.Append(Line.CreateBound(pts[i], pts[(i + 1) % pts.Length]));

            var floorType = new FilteredElementCollector(doc)
                .OfClass(typeof(FloorType)).Cast<FloorType>().First();
            var levelEl = new FilteredElementCollector(doc)
                .OfClass(typeof(Level)).Cast<Level>().First();

            using (var t = new Transaction(doc, "MCP: 바닥 생성"))
            {
                t.Start();
                var floor = Floor.Create(doc, new List<CurveLoop> { loop }, floorType.Id, levelEl.Id);
                t.Commit();
                _handler.Result = Ok(new { id = floor.Id.Value });
            }
        }

        private void CreateColumn(Document doc, string body)
        {
            var req = JsonConvert.DeserializeObject<Dictionary<string, object>>(body)
                      ?? new Dictionary<string, object>();

            double x        = Convert.ToDouble(DictGet(req, "x", (object)0));
            double y        = Convert.ToDouble(DictGet(req, "y", (object)0));
            long   levelId  = Convert.ToInt64(DictGet(req, "level_id", (object)0));

            // 기준 레벨 결정
            Level level;
            if (levelId > 0)
            {
                level = doc.GetElement(new ElementId(levelId)) as Level;
                if (level == null) throw new Exception($"레벨을 찾을 수 없습니다: {levelId}");
            }
            else
            {
                level = new FilteredElementCollector(doc)
                    .OfClass(typeof(Level)).Cast<Level>()
                    .OrderBy(l => l.Elevation).First();
            }

            // 구조 기둥 패밀리 심볼 탐색
            var symbol = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol))
                .OfCategory(BuiltInCategory.OST_StructuralColumns)
                .Cast<FamilySymbol>()
                .FirstOrDefault();

            if (symbol == null) throw new Exception(
                "구조 기둥 패밀리가 프로젝트에 없습니다. Revit에서 기둥 패밀리를 먼저 로드하세요.");

            // 미터 → 피트 변환
            double xFt = UnitUtils.ConvertToInternalUnits(x, UnitTypeId.Meters);
            double yFt = UnitUtils.ConvertToInternalUnits(y, UnitTypeId.Meters);

            using (var t = new Transaction(doc, "MCP: 기둥 생성"))
            {
                t.Start();
                if (!symbol.IsActive) symbol.Activate();
                var instance = doc.Create.NewFamilyInstance(
                    new XYZ(xFt, yFt, level.Elevation),
                    symbol, level,
                    Autodesk.Revit.DB.Structure.StructuralType.Column);
                t.Commit();

                _handler.Result = Ok(new
                {
                    id       = instance.Id.Value,
                    name     = instance.Name,
                    x        = x,
                    y        = y,
                    level    = level.Name,
                    family   = symbol.FamilyName
                });
            }
        }

        private void SetElementColor(UIDocument uidoc, string body)
        {
            var doc = uidoc.Document;
            var req = JsonConvert.DeserializeObject<Dictionary<string, object>>(body)
                      ?? new Dictionary<string, object>();

            // ids 배열 또는 단일 id 지원
            var ids = new List<ElementId>();
            if (req.ContainsKey("ids"))
            {
                foreach (var v in (Newtonsoft.Json.Linq.JArray)req["ids"])
                    ids.Add(new ElementId(Convert.ToInt64(v)));
            }
            else
            {
                ids.Add(new ElementId(Convert.ToInt64(req["id"])));
            }

            byte r = Convert.ToByte(DictGet(req, "r", (object)255));
            byte g = Convert.ToByte(DictGet(req, "g", (object)0));
            byte b = Convert.ToByte(DictGet(req, "b", (object)0));

            var view = doc.ActiveView;

            // 솔리드 채움 패턴 탐색
            var solidFill = new FilteredElementCollector(doc)
                .OfClass(typeof(FillPatternElement))
                .Cast<FillPatternElement>()
                .FirstOrDefault(fp => fp.GetFillPattern().IsSolidFill);

            using (var t = new Transaction(doc, "MCP: 색상 적용"))
            {
                t.Start();
                foreach (var eid in ids)
                {
                    var ogs = new OverrideGraphicSettings();
                    var color = new Color(r, g, b);

                    if (solidFill != null)
                    {
                        ogs.SetSurfaceForegroundPatternId(solidFill.Id);
                        ogs.SetSurfaceForegroundPatternColor(color);
                        ogs.SetProjectionLineColor(color);
                        ogs.SetCutForegroundPatternId(solidFill.Id);
                        ogs.SetCutForegroundPatternColor(color);
                    }
                    else
                    {
                        ogs.SetProjectionLineColor(color);
                    }

                    view.SetElementOverrides(eid, ogs);
                }
                t.Commit();
            }

            _handler.Result = Ok(new { count = ids.Count, r, g, b });
        }

        private void SetParameter(Document doc, string body)
        {
            var req  = JsonConvert.DeserializeObject<Dictionary<string, object>>(body)
                       ?? new Dictionary<string, object>();
            int  id  = Convert.ToInt32(req["id"]);
            string pn  = req["param"].ToString();
            string val = req["value"].ToString();

            var el = doc.GetElement(new ElementId(id));
            if (el == null) throw new Exception("요소를 찾을 수 없습니다.");

            var param = el.LookupParameter(pn);
            if (param == null)    throw new Exception($"매개변수를 찾을 수 없습니다: {pn}");
            if (param.IsReadOnly) throw new Exception("읽기 전용 매개변수입니다.");

            using (var t = new Transaction(doc, "MCP: 매개변수 설정"))
            {
                t.Start();
                switch (param.StorageType)
                {
                    case StorageType.String:  param.Set(val); break;
                    case StorageType.Double:  param.Set(Convert.ToDouble(val)); break;
                    case StorageType.Integer: param.Set(Convert.ToInt32(val)); break;
                    default: throw new Exception("지원하지 않는 매개변수 타입");
                }
                t.Commit();
            }

            _handler.Result = Ok(new { status = "ok", param = pn, value = val });
        }

        private void DeleteElement(Document doc, string body)
        {
            var req = JsonConvert.DeserializeObject<Dictionary<string, int>>(body)
                      ?? new Dictionary<string, int>();
            var el  = doc.GetElement(new ElementId(req["id"]));
            if (el == null) throw new Exception("요소를 찾을 수 없습니다.");

            using (var t = new Transaction(doc, "MCP: 요소 삭제"))
            {
                t.Start();
                doc.Delete(el.Id);
                t.Commit();
            }

            _handler.Result = Ok(new { status = "deleted", id = req["id"] });
        }

        private void RunScript(UIDocument uidoc, string body)
        {
            var req  = JsonConvert.DeserializeObject<Dictionary<string, object>>(body)
                       ?? new Dictionary<string, object>();
            string code = req["code"].ToString();

            string fullCode = @"
using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
public static class RevitScript {
    public static object Execute(UIDocument uidoc) {
        var doc  = uidoc.Document;
        var view = doc.ActiveView;
        var app  = uidoc.Application;
        object OUT = null;
        " + code + @"
        return OUT;
    }
}";
            var provider = new CSharpCodeProvider(
                new Dictionary<string, string> { { "CompilerVersion", "v4.0" } });

            var options = new CompilerParameters { GenerateInMemory = true };
            options.ReferencedAssemblies.Add(typeof(Document).Assembly.Location);
            options.ReferencedAssemblies.Add(typeof(UIDocument).Assembly.Location);
            options.ReferencedAssemblies.Add(typeof(JsonConvert).Assembly.Location);
            options.ReferencedAssemblies.Add("System.dll");
            options.ReferencedAssemblies.Add("System.Core.dll");

            var result = provider.CompileAssemblyFromSource(options, fullCode);
            if (result.Errors.HasErrors)
            {
                var errs = string.Join("; ", result.Errors.Cast<CompilerError>()
                    .Select(e => $"L{e.Line}: {e.ErrorText}"));
                throw new Exception($"컴파일 오류 — {errs}");
            }

            var type   = result.CompiledAssembly.GetType("RevitScript");
            var method = type.GetMethod("Execute");
            object output = method.Invoke(null, new object[] { uidoc });

            _handler.Result = Ok(new { output });
        }

        // ── 헬퍼 ──────────────────────────────────
        private static string Ok(object data)      => JsonConvert.SerializeObject(new { ok = true,  data });
        private static string MakeError(string msg) => JsonConvert.SerializeObject(new { ok = false, error = msg });

        private static T DictGet<T>(Dictionary<string, T> dict, string key, T defaultVal)
        {
            return dict.TryGetValue(key, out var v) ? v : defaultVal;
        }
    }
}
