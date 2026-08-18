import sys,json,sqlite3,traceback
DB=sys.argv[1]
con=sqlite3.connect(DB)
con.row_factory=sqlite3.Row
for line in sys.stdin:
    try:
        req=json.loads(line)
        mode=req['mode']
        if mode=='run':
            cur=con.execute(req['sql'],req.get('args',[]));con.commit();out={'meta':{'changes':cur.rowcount if cur.rowcount!=-1 else 0,'last_row_id':cur.lastrowid}}
        elif mode=='all':
            cur=con.execute(req['sql'],req.get('args',[]));out={'results':[dict(r) for r in cur.fetchall()]}
        elif mode=='first':
            cur=con.execute(req['sql'],req.get('args',[]));r=cur.fetchone();out=dict(r) if r else None
        elif mode=='batch':
            items=req['items'];res=[]
            try:
                con.execute('BEGIN')
                for st in items:
                    cur=con.execute(st['sql'],st.get('args',[]));res.append({'meta':{'changes':cur.rowcount if cur.rowcount!=-1 else 0,'last_row_id':cur.lastrowid}})
                con.commit();out=res
            except Exception:
                con.rollback();raise
        elif mode=='close':
            out={'ok':True};print(json.dumps(out),flush=True);break
        else: raise ValueError(mode)
        print(json.dumps({'ok':True,'value':out},ensure_ascii=False),flush=True)
    except Exception as e:
        print(json.dumps({'ok':False,'error':str(e),'trace':traceback.format_exc()},ensure_ascii=False),flush=True)
con.close()
