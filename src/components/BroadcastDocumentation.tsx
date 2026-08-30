/**
 * Documentação embutida do painel de Disparo em Massa (TASK-0171), no mesmo
 * padrão visual/estrutural de KnowledgeBaseDocumentation.tsx. Bilíngue
 * (pt/es) seguindo o idioma já escolhido em AppPreferencesContext — cada
 * bloco de texto vive em CONTENT[language], nunca hardcoded fora dele.
 */
import React from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  CircleHelp,
  ExternalLink,
  FileText,
  Layers3,
  ListChecks,
  Megaphone,
  Phone,
  Radio,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Upload,
  Users as UsersIcon,
} from 'lucide-react';
import { AppLanguage } from '../i18n/translations';

interface BroadcastDocumentationProps {
  language: AppLanguage;
  onBack: () => void;
}

// URL oficial de entrada do WhatsApp Manager pra criação de template — a
// Meta redireciona pra escolha da conta de negócio/WABA já logada do
// usuário, então não precisamos (nem podemos) apontar pra um WABA específico.
const META_TEMPLATE_CREATION_URL = 'https://business.facebook.com/wa/manage/message-templates/';

const WARMUP_ROWS: Array<{ days: string; cap: string }> = [
  { days: '1–3', cap: '20–40' },
  { days: '4–7', cap: '60–100' },
  { days: '8–14', cap: '150–250' },
  { days: '15+', cap: '500–1.000' },
];

type Tone = 'emerald' | 'sky' | 'violet' | 'amber';
const TONE_CLASSES: Record<Tone, string> = {
  emerald: 'border-emerald-400/25 bg-emerald-500/[0.07] text-emerald-100',
  sky: 'border-sky-400/25 bg-sky-500/[0.07] text-sky-100',
  violet: 'border-violet-400/25 bg-violet-500/[0.07] text-violet-100',
  amber: 'border-amber-400/25 bg-amber-500/[0.07] text-amber-100',
};

const CONTENT: Record<AppLanguage, {
  backLabel: string;
  eyebrow: string;
  title: string;
  intro: string;
  tabs: Array<{ tone: Tone; icon: React.ReactNode; title: string; description: string }>;
  warmupTitle: string;
  warmupIntro: string;
  warmupHeaderDays: string;
  warmupHeaderCap: string;
  warmupNote: string;
  metaTitle: string;
  metaIntro: string;
  metaButton: string;
  metaSteps: string[];
  metaWarning: string;
  stepsTitle: string;
  steps: string[];
  safetyTitle: string;
  safeGuaranteed: { title: string; items: string[] };
  safeOperator: { title: string; items: string[] };
  safeNever: { title: string; items: string[] };
  faqTitle: string;
  faq: Array<{ q: string; a: string }>;
}> = {
  pt: {
    backLabel: 'Voltar pro Disparo em Massa',
    eyebrow: 'Documentação',
    title: 'Como funciona o Disparo em Massa',
    intro: 'Este painel envia campanhas de WhatsApp (Marketing) pra listas de contatos usando templates aprovados pela Meta, com cadência controlada pra proteger o número contra banimento. Restrito a saas_admin.',
    tabs: [
      { tone: 'violet', icon: <Phone className="h-4 w-4" />, title: 'Números', description: 'Pool de números de disparo do tenant, separados do número operacional do agente de IA. Todo número novo entra em aquecimento automático (curva abaixo) até ganhar histórico de qualidade.' },
      { tone: 'sky', icon: <FileText className="h-4 w-4" />, title: 'Templates', description: 'Cadastro dos metadados do template já aprovado no Meta Business Manager (nome exato, idioma, variáveis, imagem de cabeçalho). A criação/aprovação continua manual na Meta — aqui só refletimos o que já existe lá.' },
      { tone: 'emerald', icon: <UsersIcon className="h-4 w-4" />, title: 'Listas de contatos', description: 'Upload de CSV com coluna "phone" obrigatória e "name" opcional; qualquer outra coluna vira variável do template. Duplicatas dentro do próprio arquivo são ignoradas automaticamente.' },
      { tone: 'amber', icon: <Megaphone className="h-4 w-4" />, title: 'Campanhas', description: 'Assistente guiado: escolhe número(s) e como dividir a lista entre eles, template, lista de contatos, confirma consentimento, envia um teste e só depois inicia — com deduplicação contra contatos já conhecidos e contra disparos recentes.' },
    ],
    warmupTitle: 'Curva de aquecimento (números novos)',
    warmupIntro: 'Enquanto um número está "Aquecendo", o teto de mensagens do dia segue esta curva — o job de envio nunca ultrapassa isso, mesmo que o número tenha capacidade configurada maior. O avanço só acontece em dias com qualidade Alta ou Média; em dia de qualidade Baixa ou não avaliada, o patamar fica congelado.',
    warmupHeaderDays: 'Dias desde a criação',
    warmupHeaderCap: 'Teto de mensagens/dia',
    warmupNote: 'Isso é uma prática de mercado de segurança, não uma regra oficial documentada pela Meta — por isso é conservadora por padrão.',
    metaTitle: 'Criar o template na Meta',
    metaIntro: 'A aprovação do template acontece inteiramente do lado da Meta, fora deste painel. Abra o WhatsApp Manager pra criar um novo template e preencha os campos seguindo esta correspondência com o modal "Novo template" daqui:',
    metaButton: 'Abrir criação de template no Meta Business Manager',
    metaSteps: [
      'Categoria: escolha "Marketing" — é o tipo de campanha que este painel assume. Não use "Utilidade" nem "Autenticação".',
      'Nome: use minúsculas e underscore (ex.: corrida_elas_2026). Copie exatamente essa mesma string pro campo "Nome exato (Meta)" do nosso modal — a Meta é sensível a maiúsculas/minúsculas na hora do envio.',
      'Idioma: escolha o idioma do template (ex.: Português (BR) = pt_BR). Preencha o mesmo código no campo "Idioma" do nosso modal.',
      'Cabeçalho: se for usar imagem, escolha "Imagem" e envie uma imagem de exemplo pra aprovação. No nosso modal, marque "Cabeçalho: Imagem" e envie a mesma imagem (ou uma equivalente) — ela é reenviada automaticamente uma vez por campanha.',
      'Corpo: escreva o texto com variáveis numeradas na ordem em que aparecem, ex.: "Oi {{1}}, sua inscrição pra {{2}} está confirmada!". No nosso modal, liste os rótulos dessas variáveis na mesma ordem em "Variáveis do corpo" (ex.: nome, evento) e reescreva o mesmo texto em "Texto do corpo" trocando os números pelos rótulos: "Oi {{nome}}, sua inscrição pra {{evento}} está confirmada!" — esse texto é só pra exibição no Atendimento, nunca é enviado à Meta.',
      'Botões: evite botões com URL dinâmica por variável — este painel não preenche parâmetros de botão. Botões fixos (sem variável) funcionam normalmente.',
      'Envie pra revisão e aguarde o status "Aprovado" antes de cadastrar/usar o template aqui — um template pendente ou rejeitado falha no envio real.',
    ],
    metaWarning: 'Se o nome, idioma ou quantidade de variáveis não baterem exatamente com o que foi aprovado na Meta, o envio falha (ou é rejeitado silenciosamente pela API). Por isso o botão "Enviar teste" é obrigatório antes de iniciar qualquer campanha.',
    stepsTitle: 'Passo a passo completo',
    steps: [
      'Cadastre ou conecte um número em "Números" (ou use um que já esteja "Ativo").',
      'Crie o template na Meta (ver seção acima) e espere aprovação.',
      'Cadastre os metadados do template aprovado em "Templates".',
      'Importe a lista de contatos por CSV em "Listas de contatos".',
      'Em "Campanhas", crie uma nova campanha: escolha número(s) e a divisão entre eles, o template e a lista.',
      'Calcule a prévia — revise quantos serão pulados por já serem conhecidos ou por duplicidade recente.',
      'Confirme o consentimento da lista e envie um teste pro telefone de alerta do tenant.',
      'Só depois do teste dar certo, clique em "Iniciar campanha" — o envio real começa respeitando a cadência do número.',
    ],
    safetyTitle: 'Regras de segurança',
    safeGuaranteed: { title: 'Garantido pelo sistema', items: ['Teto de envio por minuto e por dia, respeitando a curva de aquecimento.', 'Nunca reatribui o número de uma conversa já existente.', 'Deduplicação contra contatos já conhecidos e contra campanhas recentes.', 'Respostas de qualquer contato entram no Atendimento normal, nunca são descartadas.'] },
    safeOperator: { title: 'Depende de quem opera', items: ['Atualizar a "Qualidade" do número olhando o Meta Business Manager de tempos em tempos.', 'Confirmar de verdade que a lista importada tem consentimento — o sistema só registra a confirmação, não valida a origem dos contatos.', 'Rodar o teste antes de cada campanha nova.'] },
    safeNever: { title: 'Nunca faça', items: ['Marcar "Qualidade: Alta" sem checar de verdade — isso acelera o aquecimento além do seguro.', 'Reaproveitar o número operacional do agente de IA pra disparo em massa.', 'Ignorar uma taxa de falha alta num número específico — é sinal de risco de banimento.'] },
    faqTitle: 'Perguntas frequentes',
    faq: [
      { q: 'Por que preciso cadastrar o template aqui se ele já existe na Meta?', a: 'Porque a Meta não expõe uma forma simples de consultar templates aprovados por API neste fluxo — cadastramos os metadados aqui pra saber quais variáveis preencher e (se houver) qual imagem de cabeçalho anexar em cada envio.' },
      { q: 'Posso disparar pra alguém que já conversa com o número principal?', a: 'Por padrão não — esse contato é pulado ("já é conhecido") pra não quebrar a conversa dele com o número que já conhece. Dá pra forçar manualmente, e nesse caso o envio sai pelo número que a conversa já usa, nunca pelo número da campanha.' },
      { q: 'O que acontece se a qualidade do número cair?', a: 'Marcar "Baixa" pausa os envios desse número imediatamente e congela o avanço do aquecimento até a qualidade melhorar.' },
    ],
  },
  es: {
    backLabel: 'Volver al Envío Masivo',
    eyebrow: 'Documentación',
    title: 'Cómo funciona el Envío Masivo',
    intro: 'Este panel envía campañas de WhatsApp (Marketing) a listas de contactos usando templates aprobados por Meta, con una cadencia controlada para proteger el número contra el baneo. Restringido a saas_admin.',
    tabs: [
      { tone: 'violet', icon: <Phone className="h-4 w-4" />, title: 'Números', description: 'Grupo de números de envío del tenant, separados del número operativo del agente de IA. Todo número nuevo entra en calentamiento automático (curva abajo) hasta ganar historial de calidad.' },
      { tone: 'sky', icon: <FileText className="h-4 w-4" />, title: 'Plantillas', description: 'Registro de los metadatos de la plantilla ya aprobada en Meta Business Manager (nombre exacto, idioma, variables, imagen de encabezado). La creación/aprobación sigue siendo manual en Meta — aquí solo reflejamos lo que ya existe allí.' },
      { tone: 'emerald', icon: <UsersIcon className="h-4 w-4" />, title: 'Listas de contactos', description: 'Carga de CSV con columna "phone" obligatoria y "name" opcional; cualquier otra columna se convierte en variable de la plantilla. Los duplicados dentro del mismo archivo se ignoran automáticamente.' },
      { tone: 'amber', icon: <Megaphone className="h-4 w-4" />, title: 'Campañas', description: 'Asistente guiado: elige número(s) y cómo dividir la lista entre ellos, plantilla, lista de contactos, confirma el consentimiento, envía una prueba y solo después inicia — con deduplicación contra contactos ya conocidos y contra envíos recientes.' },
    ],
    warmupTitle: 'Curva de calentamiento (números nuevos)',
    warmupIntro: 'Mientras un número está "Calentando", el tope de mensajes del día sigue esta curva — el job de envío nunca lo supera, aunque el número tenga una capacidad configurada mayor. El avance solo ocurre en días con calidad Alta o Media; en un día de calidad Baja o sin evaluar, el nivel queda congelado.',
    warmupHeaderDays: 'Días desde la creación',
    warmupHeaderCap: 'Tope de mensajes/día',
    warmupNote: 'Esto es una práctica de mercado de seguridad, no una regla oficial documentada por Meta — por eso es conservadora por defecto.',
    metaTitle: 'Crear la plantilla en Meta',
    metaIntro: 'La aprobación de la plantilla ocurre enteramente del lado de Meta, fuera de este panel. Abra el WhatsApp Manager para crear una nueva plantilla y complete los campos siguiendo esta correspondencia con el modal "Nueva plantilla" de aquí:',
    metaButton: 'Abrir creación de plantilla en Meta Business Manager',
    metaSteps: [
      'Categoría: elija "Marketing" — es el tipo de campaña que asume este panel. No use "Utilidad" ni "Autenticación".',
      'Nombre: use minúsculas y guion bajo (ej.: corrida_elas_2026). Copie exactamente esa misma cadena en el campo "Nombre exacto (Meta)" de nuestro modal — Meta distingue mayúsculas/minúsculas al momento del envío.',
      'Idioma: elija el idioma de la plantilla (ej.: Portugués (BR) = pt_BR). Complete el mismo código en el campo "Idioma" de nuestro modal.',
      'Encabezado: si va a usar imagen, elija "Imagen" y suba una imagen de ejemplo para la aprobación. En nuestro modal, marque "Encabezado: Imagen" y suba la misma imagen (o una equivalente) — se reenvía automáticamente una vez por campaña.',
      'Cuerpo: escriba el texto con variables numeradas en el orden en que aparecen, ej.: "Hola {{1}}, tu inscripción a {{2}} está confirmada!". En nuestro modal, liste las etiquetas de esas variables en el mismo orden en "Variables del cuerpo" (ej.: nombre, evento) y reescriba el mismo texto en "Texto del cuerpo" cambiando los números por las etiquetas: "Hola {{nombre}}, tu inscripción a {{evento}} está confirmada!" — ese texto es solo para mostrarse en Atención, nunca se envía a Meta.',
      'Botones: evite botones con URL dinámica por variable — este panel no completa parámetros de botón. Los botones fijos (sin variable) funcionan normalmente.',
      'Envíe a revisión y espere el estado "Aprobado" antes de registrar/usar la plantilla aquí — una plantilla pendiente o rechazada falla en el envío real.',
    ],
    metaWarning: 'Si el nombre, idioma o cantidad de variables no coinciden exactamente con lo aprobado en Meta, el envío falla (o es rechazado silenciosamente por la API). Por eso el botón "Enviar prueba" es obligatorio antes de iniciar cualquier campaña.',
    stepsTitle: 'Paso a paso completo',
    steps: [
      'Registre o conecte un número en "Números" (o use uno que ya esté "Activo").',
      'Cree la plantilla en Meta (ver sección arriba) y espere la aprobación.',
      'Registre los metadatos de la plantilla aprobada en "Plantillas".',
      'Importe la lista de contactos por CSV en "Listas de contactos".',
      'En "Campañas", cree una nueva campaña: elija número(s) y la división entre ellos, la plantilla y la lista.',
      'Calcule la vista previa — revise cuántos serán omitidos por ya ser conocidos o por duplicidad reciente.',
      'Confirme el consentimiento de la lista y envíe una prueba al teléfono de alerta del tenant.',
      'Solo después de que la prueba funcione, haga clic en "Iniciar campaña" — el envío real comienza respetando la cadencia del número.',
    ],
    safetyTitle: 'Reglas de seguridad',
    safeGuaranteed: { title: 'Garantizado por el sistema', items: ['Tope de envío por minuto y por día, respetando la curva de calentamiento.', 'Nunca reasigna el número de una conversación ya existente.', 'Deduplicación contra contactos ya conocidos y contra campañas recientes.', 'Las respuestas de cualquier contacto entran en la Atención normal, nunca se descartan.'] },
    safeOperator: { title: 'Depende de quien opera', items: ['Actualizar la "Calidad" del número revisando Meta Business Manager de vez en cuando.', 'Confirmar de verdad que la lista importada tiene consentimiento — el sistema solo registra la confirmación, no valida el origen de los contactos.', 'Ejecutar la prueba antes de cada campaña nueva.'] },
    safeNever: { title: 'Nunca haga', items: ['Marcar "Calidad: Alta" sin verificar de verdad — eso acelera el calentamiento más allá de lo seguro.', 'Reutilizar el número operativo del agente de IA para envío masivo.', 'Ignorar una tasa de fallo alta en un número específico — es señal de riesgo de baneo.'] },
    faqTitle: 'Preguntas frecuentes',
    faq: [
      { q: '¿Por qué debo registrar la plantilla aquí si ya existe en Meta?', a: 'Porque Meta no expone una forma simple de consultar plantillas aprobadas por API en este flujo — registramos los metadatos aquí para saber qué variables completar y (si existe) qué imagen de encabezado adjuntar en cada envío.' },
      { q: '¿Puedo enviar a alguien que ya conversa con el número principal?', a: 'Por defecto no — ese contacto se omite ("ya es conocido") para no romper su conversación con el número que ya conoce. Se puede forzar manualmente, y en ese caso el envío sale por el número que la conversación ya usa, nunca por el número de la campaña.' },
      { q: '¿Qué pasa si baja la calidad del número?', a: 'Marcar "Baja" pausa los envíos de ese número de inmediato y congela el avance del calentamiento hasta que la calidad mejore.' },
    ],
  },
};

function SafetyBox({ tone, icon, title, items }: { tone: 'emerald' | 'amber' | 'rose'; icon: React.ReactNode; title: string; items: string[] }) {
  const classes: Record<typeof tone, string> = {
    emerald: 'border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-100',
    amber: 'border-amber-400/25 bg-amber-500/[0.06] text-amber-100',
    rose: 'border-rose-400/25 bg-rose-500/[0.06] text-rose-100',
  } as const;
  return (
    <section className={`rounded-2xl border p-4 sm:p-5 ${classes[tone]}`}>
      <div className="flex items-center gap-2">{icon}<h2 className="text-sm font-bold">{title}</h2></div>
      <ul className="mt-3 space-y-2 text-xs leading-relaxed">
        {items.map((item) => <li key={item} className="flex gap-2"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-current" />{item}</li>)}
      </ul>
    </section>
  );
}

export const BroadcastDocumentation: React.FC<BroadcastDocumentationProps> = ({ language, onBack }) => {
  const c = CONTENT[language];

  return (
    <section className="space-y-5" aria-labelledby="broadcast-doc-title">
      <header className="rounded-2xl border border-violet-400/25 bg-[radial-gradient(circle_at_88%_0%,rgba(167,139,250,0.16),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(15,23,42,0.84))] p-4 shadow-xl sm:p-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-violet-400/50 hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {c.backLabel}
        </button>

        <div className="mt-5 max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-violet-300"><BookOpen className="h-4 w-4" /> {c.eyebrow}</div>
          <h1 id="broadcast-doc-title" className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">{c.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">{c.intro}</p>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-md sm:p-5">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {c.tabs.map((tab) => (
            <article key={tab.title} className={`rounded-xl border p-3.5 ${TONE_CLASSES[tab.tone]}`}>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-current/20 bg-slate-950/25">{tab.icon}</span>
              <h3 className="mt-3 text-xs font-bold text-white">{tab.title}</h3>
              <p className="mt-1.5 text-[11px] leading-4 text-slate-300">{tab.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-md sm:p-5">
        <div className="flex items-center gap-2 text-amber-200"><Radio className="h-4 w-4" /><h2 className="text-sm font-bold">{c.warmupTitle}</h2></div>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{c.warmupIntro}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs text-left tabular-nums">
            <thead className="text-slate-500 border-b border-slate-800">
              <tr><th className="py-2 pr-3">{c.warmupHeaderDays}</th><th className="py-2 pr-3">{c.warmupHeaderCap}</th></tr>
            </thead>
            <tbody>
              {WARMUP_ROWS.map((row) => (
                <tr key={row.days} className="border-b border-slate-800/60">
                  <td className="py-2 pr-3 text-slate-200 font-semibold">{row.days}</td>
                  <td className="py-2 pr-3 text-slate-400">{row.cap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{c.warmupNote}</p>
      </section>

      <section className="rounded-2xl border border-violet-400/25 bg-violet-500/[0.05] p-4 shadow-md sm:p-5">
        <div className="flex items-center gap-2 text-violet-200"><Layers3 className="h-4 w-4" /><h2 className="text-sm font-bold">{c.metaTitle}</h2></div>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{c.metaIntro}</p>
        <a
          href={META_TEMPLATE_CREATION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-violet-400/40 bg-violet-600/90 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-violet-500"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {c.metaButton}
        </a>
        <ol className="mt-4 space-y-2.5 text-xs leading-relaxed text-slate-200">
          {c.metaSteps.map((step, index) => (
            <li key={step} className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-violet-400/30 bg-slate-950/40 text-[10px] font-bold text-violet-200">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] p-3 text-[11px] leading-relaxed text-amber-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          {c.metaWarning}
        </p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-md sm:p-5">
        <div className="flex items-center gap-2 text-cyan-200"><ListChecks className="h-4 w-4" /><h2 className="text-sm font-bold">{c.stepsTitle}</h2></div>
        <ol className="mt-3 space-y-2 text-xs leading-relaxed text-slate-200">
          {c.steps.map((step, index) => (
            <li key={step} className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-slate-950/40 text-[10px] font-bold text-cyan-200">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-slate-200"><ShieldCheck className="h-4 w-4 text-emerald-400" /><h2 className="text-sm font-bold">{c.safetyTitle}</h2></div>
        <div className="grid gap-3 md:grid-cols-3">
          <SafetyBox tone="emerald" icon={<BadgeCheck className="h-4 w-4 text-emerald-300" />} title={c.safeGuaranteed.title} items={c.safeGuaranteed.items} />
          <SafetyBox tone="amber" icon={<ShieldAlert className="h-4 w-4 text-amber-300" />} title={c.safeOperator.title} items={c.safeOperator.items} />
          <SafetyBox tone="rose" icon={<ShieldX className="h-4 w-4 text-rose-300" />} title={c.safeNever.title} items={c.safeNever.items} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-md sm:p-5">
        <div className="flex items-center gap-2 text-slate-200"><CircleHelp className="h-4 w-4 text-violet-300" /><h2 className="text-sm font-bold">{c.faqTitle}</h2></div>
        <div className="mt-3 space-y-3">
          {c.faq.map((item) => (
            <div key={item.q} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-xs font-bold text-white">{item.q}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="flex items-center gap-2 text-[10px] text-slate-600">
        <Upload className="h-3 w-3" />
        {language === 'pt' ? 'Documentação estática deste painel — não reflete dados reais de nenhuma campanha.' : 'Documentación estática de este panel — no refleja datos reales de ninguna campaña.'}
      </p>
    </section>
  );
};
