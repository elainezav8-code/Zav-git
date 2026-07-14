/* Frentes: app (etapa 3). Sem build, sem framework. */

var CHAVE_CFG = 'frentes_cfg';
var CHAVE_ESTADO = 'frentes_estado';

var cfg = lerJson_(CHAVE_CFG);
var estado = lerJson_(CHAVE_ESTADO);
var telaAtiva = 'hoje';

function lerJson_(chave) {
  try { return JSON.parse(localStorage.getItem(chave) || 'null'); }
  catch (e) { return null; }
}

function $(seletor) { return document.querySelector(seletor); }

/* ------------------------------------------------------------ backend --- */

function chamarBackend(carga) {
  var corpo = Object.assign({ token: cfg.token }, carga);
  return fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(corpo)
  }).then(function (r) { return r.json(); });
}

function atualizarEstado() {
  return fetch(cfg.url + '?token=' + encodeURIComponent(cfg.token))
    .then(function (r) { return r.json(); })
    .then(function (dados) {
      if (!dados.ok) throw new Error(dados.erro || 'resposta invalida');
      guardarEstado(dados);
    });
}

function guardarEstado(dados) {
  estado = dados;
  localStorage.setItem(CHAVE_ESTADO, JSON.stringify(dados));
  render();
}

/* -------------------------------------------------------------- fluxo --- */

function iniciar() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }

  $('#cfg-salvar').addEventListener('click', salvarConfig);
  $('#form-fala').addEventListener('submit', enviarFrase);
  document.querySelectorAll('nav button').forEach(function (botao) {
    botao.addEventListener('click', function () { trocarTela(botao.dataset.tela); });
  });

  if (!cfg || !cfg.url || !cfg.token) {
    $('#tela-config').classList.remove('oculta');
    return;
  }
  entrar();
}

function entrar() {
  $('#tela-config').classList.add('oculta');
  $('#app').classList.remove('oculta');
  render();
  atualizarEstado().catch(function (erro) {
    toast('Sem conexao com o backend: ' + erro.message, true);
  });
}

function salvarConfig() {
  var url = $('#cfg-url').value.trim();
  var token = $('#cfg-token').value.trim();
  if (url.indexOf('https://script.google.com/') !== 0 || url.indexOf('/exec') === -1) {
    $('#cfg-erro').textContent = 'A URL deve ser a do Web App, terminando em /exec.';
    return;
  }
  if (!token) {
    $('#cfg-erro').textContent = 'Falta o token.';
    return;
  }
  cfg = { url: url.split('?')[0], token: token };
  localStorage.setItem(CHAVE_CFG, JSON.stringify(cfg));
  entrar();
}

function enviarFrase(evento) {
  evento.preventDefault();
  var campo = $('#campo-fala');
  var texto = campo.value.trim();
  if (!texto) return;
  campo.value = '';
  pensando(true);
  chamarBackend({ texto: texto })
    .then(function (r) {
      pensando(false);
      if (!r.ok) { toast(r.erro || 'Nao deu certo. Fale de novo.', true); return; }
      if (r.estado) guardarEstado(r.estado);
      toast(r.resposta || 'Anotado.');
    })
    .catch(function () {
      pensando(false);
      toast('Sem conexao. A frase nao foi enviada: ' + texto, true);
    });
}

function comando(cmd, mensagem) {
  pensando(true);
  chamarBackend({ comando: cmd })
    .then(function (r) {
      pensando(false);
      if (!r.ok) { toast(r.erro || 'Nao deu certo.', true); return; }
      if (r.estado) guardarEstado(r.estado);
      if (mensagem) toast(mensagem);
    })
    .catch(function () {
      pensando(false);
      toast('Sem conexao. Tente de novo.', true);
    });
}

function trocarTela(nome) {
  telaAtiva = nome;
  document.querySelectorAll('nav button').forEach(function (botao) {
    botao.classList.toggle('ativa', botao.dataset.tela === nome);
  });
  ['hoje', 'frentes', 'ideias'].forEach(function (tela) {
    $('#tela-' + tela).classList.toggle('oculta', tela !== nome);
  });
  render();
}

/* ------------------------------------------------------------- render --- */

function render() {
  if (!estado) {
    $('#tela-' + telaAtiva).innerHTML = '<p class="vazio">Carregando...</p>';
    return;
  }
  renderHoje();
  renderFrentes();
  renderIdeias();
}

function ativas_() {
  return estado.frentes.filter(function (f) { return f.status === 'ativa'; });
}

function renderHoje() {
  var tela = $('#tela-hoje');
  var frente = estado.frenteDoDia && estado.frenteDoDia.status === 'ativa' ? estado.frenteDoDia : null;

  if (!frente) {
    var lista = ativas_();
    if (!lista.length) {
      tela.innerHTML = '<p class="vazio">Nenhuma frente ativa.<br>Fale o que esta em andamento que eu estruturo.</p>';
      return;
    }
    tela.innerHTML = '<p class="hoje-rotulo">Qual e a frente de hoje?</p><div class="escolha-frente"></div>';
    var caixa = tela.querySelector('.escolha-frente');
    lista.forEach(function (f) {
      var botao = document.createElement('button');
      botao.textContent = f.nome;
      botao.addEventListener('click', function () {
        var fundamento = prompt('Por que essa? (opcional)') || '';
        comando({ tipo: 'priorizar', frente_id: f.id, fundamento: fundamento }, 'Frente do dia definida.');
      });
      caixa.appendChild(botao);
    });
    return;
  }

  var passo = frente.proximoPasso;
  var html = '<p class="hoje-rotulo">Frente de hoje</p>' +
    '<p class="hoje-frente">' + escapar(frente.nome) +
    (estado.fundamentoDoDia ? '<span class="hoje-fundamento">' + escapar(estado.fundamentoDoDia) + '</span>' : '') +
    '</p>';

  if (passo) {
    html += '<p class="hoje-rotulo">Proximo passo (' + passo.ordem + ' de ' + frente.passos.length + ')</p>' +
      '<div class="hoje-passo">' + escapar(passo.descricao) + '</div>' +
      '<button class="hoje-feito">Feito</button>';
  } else {
    html += '<div class="hoje-passo">Todos os passos desta frente estao feitos. Fale qual e o proximo movimento.</div>';
  }

  if (frente.ondeParei) {
    html += '<div class="hoje-parada"><p class="hoje-rotulo">Onde voce tinha parado</p><p>' + escapar(frente.ondeParei) + '</p></div>';
  }

  tela.innerHTML = html;
  var botaoFeito = tela.querySelector('.hoje-feito');
  if (botaoFeito) {
    botaoFeito.addEventListener('click', function () {
      comando({ tipo: 'concluir_passos', frente_id: frente.id, ordens: [passo.ordem] }, 'Passo concluido.');
    });
  }
}

function renderFrentes() {
  var tela = $('#tela-frentes');
  tela.innerHTML = '';

  estado.frentes.forEach(function (f, indice) {
    if (!f.numero) f.numero = indice + 1;
  });

  (estado.avisos || []).forEach(function (aviso) {
    var caixa = document.createElement('div');
    caixa.className = 'aviso';
    caixa.textContent = aviso;
    tela.appendChild(caixa);
  });

  var ativas = ativas_();
  var congeladas = estado.frentes.filter(function (f) { return f.status === 'congelada'; });

  if (!ativas.length && !congeladas.length) {
    tela.innerHTML += '<p class="vazio">Nenhuma frente ainda.<br>Fale o que esta em andamento que eu estruturo.</p>';
    return;
  }

  ativas.forEach(function (f) { tela.appendChild(cartaoFrente(f)); });

  if (congeladas.length) {
    var titulo = document.createElement('p');
    titulo.className = 'secao-titulo';
    titulo.textContent = 'Congeladas';
    tela.appendChild(titulo);
    congeladas.forEach(function (f) { tela.appendChild(cartaoFrente(f)); });
  }
}

var frentesAbertas = {};

function cartaoFrente(f) {
  var cartao = document.createElement('div');
  cartao.className = 'frente-cartao' + (f.status === 'congelada' ? ' congelada' : '');
  var aberta = Boolean(frentesAbertas[f.id]);

  var dias = f.diasSemToque === 0 ? 'hoje' : f.diasSemToque + 'd sem toque';
  var topo = document.createElement('div');
  topo.className = 'frente-topo';
  topo.innerHTML =
    '<span class="frente-nome"><span class="frente-numero">' + (f.numero || '') + '</span>' + escapar(f.nome) + '</span>' +
    '<span class="frente-meta">' + f.percentual + '% &middot; ' + dias +
    ' <span class="seta">' + (aberta ? '&#9652;' : '&#9662;') + '</span></span>';
  topo.addEventListener('click', function () {
    frentesAbertas[f.id] = !aberta;
    render();
  });
  cartao.appendChild(topo);

  var trilha = document.createElement('div');
  trilha.className = 'trilha';
  var atualMarcado = false;
  f.passos.forEach(function (p) {
    var seg = document.createElement('span');
    if (p.feito) {
      seg.className = 'feito';
    } else if (!atualMarcado) {
      seg.className = 'atual';
      atualMarcado = true;
    }
    trilha.appendChild(seg);
  });
  trilha.addEventListener('click', function () {
    frentesAbertas[f.id] = !aberta;
    render();
  });
  cartao.appendChild(trilha);

  if (aberta) {
    var lista = document.createElement('ul');
    lista.className = 'passos-lista';
    var atualAchado = false;
    f.passos.forEach(function (p) {
      var item = document.createElement('li');
      if (p.feito) {
        item.className = 'passo-feito';
        item.textContent = p.ordem + '. ' + p.descricao;
        if (f.status === 'ativa') {
          var desfazer = document.createElement('button');
          desfazer.textContent = 'desfazer';
          desfazer.addEventListener('click', function (evento) {
            evento.stopPropagation();
            comando({ tipo: 'reabrir_passos', frente_id: f.id, ordens: [p.ordem] }, 'Passo desmarcado.');
          });
          item.appendChild(desfazer);
        }
      } else {
        if (!atualAchado) { item.className = 'passo-atual'; atualAchado = true; }
        item.textContent = p.ordem + '. ' + p.descricao;
        if (f.status === 'ativa') {
          var botao = document.createElement('button');
          botao.textContent = 'feito';
          botao.addEventListener('click', function (evento) {
            evento.stopPropagation();
            comando({ tipo: 'concluir_passos', frente_id: f.id, ordens: [p.ordem] }, 'Passo concluido.');
          });
          item.appendChild(botao);
        }
      }
      lista.appendChild(item);
    });
    if (!f.passos.length) {
      var vazio = document.createElement('li');
      vazio.textContent = 'Sem passos registrados. Fale o proximo movimento desta frente.';
      lista.appendChild(vazio);
    }
    cartao.appendChild(lista);
  } else if (f.proximoPasso && f.status === 'ativa') {
    var atual = document.createElement('div');
    atual.className = 'frente-passo-atual';
    atual.textContent = f.proximoPasso.descricao;
    var botaoAtual = document.createElement('button');
    botaoAtual.textContent = 'Marcar feito';
    botaoAtual.addEventListener('click', function () {
      comando({ tipo: 'concluir_passos', frente_id: f.id, ordens: [f.proximoPasso.ordem] }, 'Passo concluido.');
    });
    atual.appendChild(document.createElement('br'));
    atual.appendChild(botaoAtual);
    cartao.appendChild(atual);
  }

  if (f.ondeParei) {
    var parada = document.createElement('p');
    parada.className = 'frente-parada';
    parada.textContent = 'Onde parei: ' + f.ondeParei;
    cartao.appendChild(parada);
  }

  return cartao;
}

function renderIdeias() {
  var tela = $('#tela-ideias');
  tela.innerHTML = '';

  var quarentena = estado.ideias.filter(function (i) { return i.status === 'quarentena'; });
  var esperando = estado.ideias.filter(function (i) { return i.status === 'esperando'; });

  if (!quarentena.length && !esperando.length) {
    tela.innerHTML = '<p class="vazio">Nenhuma ideia guardada.<br>Quando uma empolgacao aparecer, fale. Ela espera 72 horas antes de poder ser julgada.</p>';
    return;
  }

  quarentena.forEach(function (i) {
    var cartao = document.createElement('div');
    cartao.className = 'ideia-cartao';
    var faltam = Math.max(0, 72 - i.horasDeQuarentena);
    var estadoTxt = i.julgavel
      ? 'Pronta para julgar. Fale o destino: vira frente, espera ou morre.'
      : 'Em quarentena. Faltam ' + faltam + 'h para poder julgar.';
    cartao.innerHTML = '<p class="ideia-texto">' + escapar(i.texto) + '</p>' +
      '<p class="ideia-estado' + (i.julgavel ? ' pronta' : '') + '">' + estadoTxt + '</p>';
    tela.appendChild(cartao);
  });

  if (esperando.length) {
    var titulo = document.createElement('p');
    titulo.className = 'secao-titulo';
    titulo.textContent = 'Esperando';
    tela.appendChild(titulo);
    esperando.forEach(function (i) {
      var cartao = document.createElement('div');
      cartao.className = 'ideia-cartao';
      cartao.innerHTML = '<p class="ideia-texto">' + escapar(i.texto) + '</p>';
      tela.appendChild(cartao);
    });
  }
}

/* --------------------------------------------------------------- apoio --- */

function pensando(ligado) {
  $('#pensando').classList.toggle('oculta', !ligado);
}

var temporizadorToast = null;
function toast(mensagem, ehErro) {
  var caixa = $('#toast');
  caixa.textContent = mensagem;
  caixa.className = ehErro ? 'erro' : '';
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(function () { caixa.className = 'oculta'; }, 5000);
}

function escapar(texto) {
  var div = document.createElement('div');
  div.textContent = String(texto == null ? '' : texto);
  return div.innerHTML;
}

iniciar();
