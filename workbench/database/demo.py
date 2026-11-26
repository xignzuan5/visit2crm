"""输出可重跑的演示数据 SQL。逐字稿仅使用本文定义的虚构素材。"""
import json
from datetime import date, timedelta

PEOPLE = [
    ("岑星禾", 0, 1, 86), ("虞知沐", 1, 2, 32), ("陶青屿", 2, 0, 165),
    ("晏弦舟", 3, 1, 58), ("阮时苒", 0, 2, 46), ("邵望川", 1, 3, 110),
]
SNAPSHOT = date(2026, 11, 25)
# 从早到晚。数字只表示距快照日的天数、以及在该成员第几次拜访谈到了某个话题。
DAYS_AGO = [
    [88,65,42,29,21,15,8,2], [83,60,44,33,22,11,3], [89,72,54,37,26,18,9,1],
    [79,58,45,25,14,4], [86,68,48,34,23,13,6,0], [87,70,51,38,29,19,12,5,1],
]
# 每个脚本条目驱动下面真实发言和提取结果的生成；不存储个人分数。
TOPICS = [
    dict(metrics="1235678", buyer="", champion="12345678", decision="124678", paper="26", next="134568",
         rival="123578", comparison="37", tech="123678", validated="128", opens="1235678"),
    dict(metrics="25", buyer="1234567", champion="123567", decision="1234567", paper="3", next="6",
         rival="12467", comparison="47", tech="12367", validated="", opens="23567"),
    dict(metrics="28", buyer="2468", champion="12345678", decision="12345678", paper="1235678", next="1234578",
         rival="123568", comparison="8", tech="234678", validated="68", opens=""),
    dict(metrics="", buyer="2356", champion="123456", decision="12456", paper="246", next="346",
         rival="123456", comparison="12356", tech="13456", validated="36", opens="25"),
    dict(metrics="2468", buyer="26", champion="12345678", decision="123678", paper="367", next="2368",
         rival="4", comparison="", tech="12345678", validated="1235678", opens="158"),
    dict(metrics="13579", buyer="359", champion="123456789", decision="1235679", paper="169", next="359",
         rival="12356789", comparison="169", tech="7", validated="", opens="12456789"),
]
# 行业、客户后缀、业务痛点、量化目标、验收需求、技术问题、回答、客户验证
SECTORS = [
 ("智能制造","智造","换线时，质检员还得挨个工位核对批次。","追溯一批物料要两小时，我们想压到十分钟。","批次追溯","断网以后，产线扫码的顺序还保得住吗？","先在工位缓存扫描序号，恢复连接后按序补传，再用批次号查重。","刚才拔网线测过了，补传后批次顺序也对得上。"),
 ("连锁零售","商贸","各店各报一张表，总部看到缺货时往往已经晚了。","现在补货要等两天，希望能在当天闭店前完成。","门店补货","几家门店报同一件货时，库存会重复扣吗？","按门店和订单生成唯一流水，重复请求只确认已有预留。","同一单我连点了两次，仓里确实只预留了一份。"),
 ("企业服务","云创","交付组每周都在拼各系统导出的权限清单。","原来权限复核要五天，我们希望一天内完成。","权限审计","顾问只能看自己的项目，跨项目导出怎么挡？","按项目分配角色，导出任务沿用发起人权限，并保留操作记录。","我换了顾问账号，导出结果里确实只有自己的项目。"),
 ("仓储物流","仓配","晚班把异常登记在纸上，白班接手时常漏掉一件。","每周漏交接四五次，试点目标是一个月不超过一次。","异常交接","跨班次转交时，原来经手的人还能查到吗？","转交会追加一条带时间的记录，原经手人和接手人都留在同一条运单下。","抽的三张运单都能对上两班的人和时间，可以据此验收。"),
]
PREFIX = ["栖岚","镜穗","折光","杉序","溪砾","弦浦","月栈","云芥","檐丘","竹汀"]
RIVALS = ["砾帆方案","青穹方案","汐尺系统","原有自建系统"]
STAGES = ["需求澄清","方案验证","商务采购"]
SIZES = ["小型","中型","大型"]
KEYS = ["pain","metrics","economic_buyer","decision_criteria","decision_process","paper_process","champion","competition"]
SQUADS = ["生产","运营","交付","仓务"]
def literal(v):
    if v is None: return "NULL"
    if isinstance(v,(dict,list)): v=json.dumps(v,ensure_ascii=False,separators=(',',':'))
    return "'" + str(v).replace("'","''") + "'"
def insert(table,columns,rows):
    values=",\n".join("("+",".join(literal(v) for v in row)+")" for row in rows)
    conflict = "DO NOTHING"
    if table == "persona_visits":
        changed = columns.split(",")[1:]
        assignments = ", ".join(f"{col}=EXCLUDED.{col}" for col in changed)
        old = ", ".join(f"{table}.{col}" for col in changed)
        new = ", ".join(f"EXCLUDED.{col}" for col in changed)
        conflict = f"DO UPDATE SET {assignments}, _updated_at=CURRENT_TIMESTAMP WHERE ({old}) IS DISTINCT FROM ({new})"
    print(f"INSERT INTO {table} ({columns}) VALUES\n{values}\nON CONFLICT (id) {conflict};")
def build_deals(i, sid, primary, secondary, base):
    rows = []
    for j in range(10):
        sector = primary if j in (0, 1, 3, 4, 6, 8) else secondary
        industry, suffix = SECTORS[sector][:2]
        amount = round(base * [.75,1.1,.5,1.25,1.4,.8,1.7,.65,1.0,1.35][j])
        outcome = "在跟" if j < 2 + i % 2 else "输单" if (j+i)%4==0 or (i==3 and j==6) else "赢单"
        closed = None
        if outcome != "在跟":
            closed = str(date(2026,10,7)+timedelta(days=7*j+i*2) if j<6 else date(2026,11,22)-timedelta(days=(j-3)*34+i*3 if j!=9 else 395))
        rows.append((f"{sid}-d{j+1}",sid,PREFIX[i]+PREFIX[j]+suffix,industry,amount,
            SIZES[0 if amount<35 else 1 if amount<100 else 2],STAGES[(i+j)%3],outcome,
            RIVALS[(sector+(j==7))%4],closed))
    return rows


def build_visit(i, number, day, deal):
    topic = TOPICS[i]
    def covered(name):
        return str(number) in topic[name]
    sector = next(k for k, item in enumerate(SECTORS) if item[0] == deal[3])
    _, _, pain, metrics, need, problem, answer, verified = SECTORS[sector]
    team, rival = SQUADS[sector], deal[8]
    turns = []
    fields = {k: dict(known=False, summary="", quote="") for k in KEYS}
    def say(role, text, signal=None):
        turns.append(dict(role=role, text=text, **({"signal":signal} if signal else {})))
    def ask(key, opened, closed, quote, summary):
        say("销售", opened if covered("opens") else closed)
        say("客户", quote)
        fields[key] = dict(known=True, summary=summary, quote=quote)
    say("销售", f"今天从{need}的试点说起。")
    if i == 2:
        say("销售","我按上次的范围带来了试点计划。先过准备清单，再核对两个签字环节，最后定下交付顺序。我会把需要贵方确认的地方逐条念出来，今天就把负责人与节点对齐。")
    say("客户", ["我把上一班留下的表带来了。","这次有两份样本，可以当场核。","我们昨天刚复盘过这件事。"][number%3])
    ask("pain","现场最耽误工作的是哪一步？","目前还是卡在现场交接，对吗？",pain,"现场障碍及其影响")
    if covered("metrics"):
        ask("metrics","试点希望把哪个数字改到多少？","您有一个明确的改善目标，对吗？",metrics,"客户给出量化目标")
    if covered("buyer"):
        quote, summary = [
            ("技改款在厂长手里，试点转正式采购得他批。", "厂长决定技改款的使用"),
            ("单店可以先试，铺到全部门店的钱要区域总经理批。", "区域总经理审批推广预算"),
            ("财务总监看完回收期才会放款，最后由她拍板。", "财务总监作最终拨款决定"),
            ("钱从仓配事业部出，负责人同意追加我们才能下单。", "事业部负责人批准追加投入"),
        ][sector]
        ask("economic_buyer","谁最终批这笔预算？","这笔预算的最终审批人已经确定了吗？",quote,summary)
    if covered("champion"):
        quote, summary = [
            ("我来约当班的同事试用，下周我把反馈带给评审组。", "客户联络人组织试用并反馈"),
            ("把试点材料发我，我会在周会上替你们争取名额。", "客户联络人主动为试点争取名额"),
            ("这事我愿意牵头。现场的几个难点，我带你们去找组长核实。", "客户联络人牵头协调一线核实"),
            (f"我和{team}组一起做复盘，由我把试点的收益讲给经理听。", "客户联络人向经理说明试点收益"),
        ][(i + number) % 4]
        ask("champion","内部谁愿意牵头协调试点？","您愿意出面推动试点吗？",quote,summary)
    if number%3 != 0:
        ask("decision_criteria","验收会看哪些表现？","这轮还是用业务样本验收吗？",
            f"我想用我们的一份样本测{need}，要能对上原记录。",f"用真实样本验证{need}")
    if covered("decision"):
        ask("decision_process","试点之后怎么决定是否采用？","试点后还会进评审吗？",
            ["班组长复核，部门经理看试点报告，两关都过才报预算。","先由业务组评估，再把评估单带到月度决策会。","先做双班试点，结果由评审小组签字后再提交立项。"][number%3],"客户确认评估和决策步骤")
    if covered("paper"):
        ask("paper_process","签合同还需要哪些手续？","采购需要法务先审文本吗？",
            "采购要先留两份比选记录，法务审完合同，财务才能排付款。","比选、审合同、排付款")
    if covered("next"):
        say("销售","我们把复盘的时间和负责人定下来，好吗？")
        next_day=day+timedelta(days=3)
        say("客户",f"我来发样本，约在{next_day.month}月{next_day.day}日由业务组一起复盘。","next")
    if covered("rival"):
        ask("competition","您还在比较哪些方案？","已经有备选方案了吗？",
            f"我们手里还有{rival}的方案，想知道现场用起来差在哪。",f"正在对照{rival}")
        if covered("comparison"):
            say("销售",f"把两套方案放在同一组{need}样本上，各跑一遍，再一起对照错漏项。","comparison")
    if covered("tech"):
        say("客户",problem,"technical_question")
        say("销售",answer,"technical_answer")
        if covered("validated"):
            say("客户",verified,"validated")
    if i==5 and number not in (3,8):
        say("销售","如果只能先解决一件事，您最想改变什么？")
        say("客户",f"先让一线的人拿到同一份{need}记录。现在主管交班要翻好几张表，我希望下一班接过来就知道该跟哪一项。")
    if i==2:
        say("销售","我稍后发一份按日期拆开的清单，业务评审、签字、交付都单列出来。您按照清单上的节点确认，我们逐项推进；今天的会议记录也由我整理。")
    if i==5:
        say("销售","我把刚才的重点记下了。")
    else:
        say("销售","我把今天确认的内容发给您核对。")
    titles=["现场走访","需求访谈","样本复核","联合评审","方案交流","试点复盘","二次验证","现场答疑","跟进回访"]
    return (f"s{i+1}-v{number}", deal[0], titles[number-1], str(day), turns, fields)


def build():
    people, deals, visits = [], [], []
    for i,(name,primary,secondary,base) in enumerate(PEOPLE):
        sid=f"s{i+1}"
        people.append((sid,name))
        current=build_deals(i,sid,primary,secondary,base)
        deals.extend(current)
        for j,age in enumerate(DAYS_AGO[i]):
            day=SNAPSHOT-timedelta(days=age)
            deal=current[j%6]
            if deal[9] and deal[9]<str(day):
                deal=current[j%2]
            visits.append(build_visit(i,j+1,day,deal))
    return people,deals,visits


if __name__=="__main__":
    people,deals,visits=build()
    print("BEGIN;")
    insert("persona_sellers","id,name",people)
    insert("persona_deals","id,seller_id,company,industry,amount_wan,customer_size,stage,outcome,competitor,closed_on",deals)
    insert("persona_visits","id,deal_id,title,happened_on,turns,fields",visits)
    print("COMMIT;")
