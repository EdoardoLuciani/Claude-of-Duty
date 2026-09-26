# One-time migration helper: translate the straight-line authored GLSL surface
# expressions into TSL function graphs. Inspect and parity-test output before use.
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
functions = set()

def toks(expr):
    parts = re.findall(r'\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|[+*/\-().,]', expr)
    if ''.join(parts) != re.sub(r'\s+', '', expr):
        raise ValueError('unsupported expression: ' + expr)
    return parts

class Parser:
    def __init__(self, expr):
        self.tokens = toks(expr)
        self.i = 0
    def peek(self): return self.tokens[self.i] if self.i < len(self.tokens) else ''
    def pop(self):
        token = self.peek(); self.i += 1; return token
    def read(self, minimum=0):
        token = self.pop()
        if token == '-':
            left = f'({self.read(5)}).negate()'
        elif token == '(':
            left = self.read()
            assert self.pop() == ')'
        elif re.fullmatch(r'\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', token):
            left = f'float({token})'
        elif re.fullmatch(r'[A-Za-z_]\w*', token):
            if self.peek() == '(':
                self.pop(); args = []
                while self.peek() != ')':
                    args.append(self.read())
                    if self.peek() == ',': self.pop()
                    else: break
                assert self.pop() == ')', (token, self.tokens[self.i-3:self.i+3])
                left = call(token, args)
            else:
                left = {'uv':'coords','uSeed':'seed','uTintA':'tintA',
                        'uTintB':'tintB','uParam':'param'}.get(token,token)
        else:
            raise ValueError((token, self.tokens))
        while self.peek() == '.':
            self.pop(); left += '.' + self.pop()
        while self.peek() in ('+', '-', '*', '/') and (prec := {'+':1,'-':1,'*':2,'/':2}[self.peek()]) >= minimum:
            op = self.pop()
            right = self.read(prec + 1)
            method = {'+':'add','-':'sub','*':'mul','/':'div'}[op]
            left = f'({left}).{method}({right})'
        return left
    def parse(self):
        expression = self.read()
        assert self.i == len(self.tokens), self.tokens[self.i:]
        return expression

def call(name, args):
    alias = {'owWorley':'worley','owCracks':'cracks','owScratches':'scratches',
             'owShear':'shear','owShearPer':'shearPeriod','owHash11':'hash11',
             'owHash12':'hash12','owHash42':'hash42','owBillow':'billow5',
             'owWarp':'domainWarp','owRustColour':'rustColor'}
    original = name
    if name in ('owFbm','owFbm01','owBillow','owRidged'):
        assert args[2].startswith('float(') and args[2].endswith(')'), (name,args)
        octaves = int(float(args.pop(2)[6:-1]))
        if name == 'owBillow': assert octaves == 5
        if name == 'owRidged': name = 'ridged'+str(octaves)
        elif name == 'owBillow': name = 'billow5'
        else: name = 'fbm'+str(octaves)
        result = f'{name}({", ".join(args)})'
        if name == 'fbm'+str(octaves) and original == 'owFbm01':
            functions.add('fbm01')
            return f'fbm01({result})'
        functions.add(name)
        return result
    if name == 'owSRGB':
        assert args[0].startswith('vec3('), args
        name = 'authoredColor'
        args = [x.strip() for x in split_args(args[0][5:-1])]
        assert all(re.fullmatch(r'float\([\d.]+\)', x) for x in args), args
        args = [x[6:-1] for x in args]
    if name == 'owWarp':
        assert args[3].startswith('float('), args
        args[3] = str(int(float(args[3][6:-1])))
    if name == 'smoothstep':
        def val(x):
            return float(x[6:-1]) if re.fullmatch(r'float\([\d.]+\)', x) else None
        a, b = val(args[0]), val(args[1])
        if a is not None and b is not None and a > b:
            args[0], args[1] = args[1], args[0]
            functions.add(name)
            return f'smoothstep({", ".join(args)}).oneMinus()'
    name = alias.get(name, name)
    functions.add(name)
    return f'{name}({", ".join(args)})'

def split_args(text):
    out = []; start=0; depth=0
    for i,c in enumerate(text):
        if c=='(': depth+=1
        elif c==')': depth-=1
        elif c==',' and depth==0: out.append(text[start:i]);start=i+1
    out.append(text[start:]);return out

for group in ('ground','arch','metal','organic'):
    source = (root/f'src/materials/glsl/surfaces-{group}.js').read_text()
    records = re.findall(r'export const (\w+) = /\* glsl \*/ `(.*?)`;',source,re.S)
    lines = ["import { Fn, float, vec3, vec4, vec2 } from 'three/tsl';",
             "import { authoredColor } from '../color-tsl.js';",
             "import { Surface } from './surface.js';",
             "import { NOISE_IMPORTS } from '../noise-tsl.js';", '']
    names = []
    for name, body in records:
        if name in ('RUST_HELPERS','SAND','METAL_BRUSHED','FOLIAGE','RUBBER','GLASS'): continue
        body = re.sub(r'/\*.*?\*/|//[^\n]*','',body,flags=re.S)
        body = body.split('{',1)[1].rsplit('}',1)[0]
        stmts = [x.strip() for x in body.split(';') if x.strip()]
        expanded = []
        for stmt in stmts:
            decl = re.fullmatch(r'((?:const\s+)?(?:float|vec[234]))\s+(.*)',stmt,re.S)
            parts = split_args(decl[2]) if decl else []
            if len(parts) > 1 and all(re.fullmatch(r'\s*\w+\s*=.*',x,re.S) for x in parts):
                expanded.extend(decl[1]+' '+x.strip() for x in parts)
            else: expanded.append(stmt)
        stmts = expanded
        ident = ''.join([t.title() if i else t for i,t in enumerate(name.lower().split('_'))])+'Surface'
        names.append(ident)
        begin = len(lines)
        lines += [f'// {name}: authored channel stack migrated from surfaces-{group}.js.',
                  f'export const {ident} = Fn(([coords, seed, tintA, tintB, param]) => {{',
                  '  const alb = vec3(0.5).toVar(), h = float(0.5).toVar();',
                  '  const rough = float(0.5).toVar(), metal = float(0).toVar(), ao = float(1).toVar();']
        for s in stmts:
            m = re.fullmatch(r'(?:const\s+)?(?:float|vec[234])\s+(\w+)\s*=\s*(.*)',s,re.S)
            if m:
                var,expression = m.groups()
                lines.append(f'  const {var} = {Parser(expression).parse()}.toVar();')
                continue
            m = re.fullmatch(r'(\w+)\s*(\+=|-=|\*=|/=|=)\s*(.*)',s,re.S)
            if not m: raise ValueError((name,s))
            var,op,expression=m.groups()
            lines.append(f'  {var}.{ {"=":"assign","+=":"addAssign","-=":"subAssign","*=":"mulAssign","/=":"divAssign"}[op] }({Parser(expression).parse()});')
        lines += ['  return Surface(alb, h, rough, metal, ao);','});','']
        bodyText = '\n'.join(lines[begin + 2:])
        params = ['coords', 'seed', 'tintA', 'tintB', 'param']
        while params and params[-1] not in ('coords','seed') and not re.search(r'\b'+params[-1]+r'\b', bodyText):
            params.pop()
        params = [x if re.search(r'\b'+x+r'\b', bodyText) else '' for x in params]
        lines[begin + 1] = f'export const {ident} = Fn(([{", ".join(params)}]) => {{'
    used = set(re.findall(r'\b([a-zA-Z_]\w*)\s*\(', '\n'.join(lines[5:])))
    three = {'Fn','float','vec3','vec4','vec2','abs','clamp','mix','pow','sign','sin','cos','exp',
             'floor','fract','step','smoothstep','max','min','length','mod','normalize'}
    noise = {'worley','cracks','scratches','shear','shearPeriod','hash11','hash12','hash42',
             'billow5','ridged4','ridged5','domainWarp','fbm3','fbm4','fbm5','fbm01'}
    lines[0] = "import { "+', '.join(sorted((used&three)|{'Fn','float','vec3'}))+" } from 'three/tsl';"
    lines[3] = "import { "+', '.join(sorted((used&noise)-{'domainWarp'} | ({'warp as domainWarp'} if 'domainWarp' in used else set())))+" } from '../noise-tsl.js';"
    if 'rustColor' in used:
        lines.insert(4, "import { rustColor } from './rust-color.js';")
    (root/f'src/materials/tsl/{group}.js').write_text('\n'.join(lines)+'\n')
    print(group, names)
