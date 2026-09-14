# Baixa todas as imagens do CDN do Webflow para a pasta assets/ e troca os links no index.html.
# Uso: python3 baixar-imagens.py   (na pasta onde está o index.html)
import re, os, urllib.request
s = open('index.html', encoding='utf-8').read()
urls = sorted(set(re.findall(r'https://cdn\.prod\.website-files\.com/[^\s"\')]+', s)))
os.makedirs('assets', exist_ok=True)
for u in urls:
    name = u.split('/')[-1]
    dest = os.path.join('assets', name)
    if not os.path.exists(dest):
        try:
            urllib.request.urlretrieve(u, dest); print('ok ', name)
        except Exception as e:
            print('ERRO', name, e); continue
    s = s.replace(u, 'assets/' + name)
open('index.html', 'w', encoding='utf-8').write(s)
print(len(urls), 'imagens processadas')
