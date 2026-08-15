import React, { useState } from 'react';
import { X, FileText, Printer, ArrowLeft } from 'lucide-react';

interface ContractModalProps {
  isOpen: boolean;
  onClose: () => void;
  buyerName: string;
}

interface AccessoryItem {
  label: string;
  included: boolean;
}

const DEFAULT_ACCESSORIES: AccessoryItem[] = [
  { label: 'Instalación (Medición - Excavación - Nivelación - Compactación)', included: true },
  { label: 'Filtro Arena', included: true },
  { label: 'Un Motor', included: true },
  { label: 'Casa de Máquina de Fibra', included: true },
  { label: 'Kit de Hidromasaje (02) unidades', included: true },
  { label: 'Dispositivo de Dreno de Fondo', included: true },
  { label: 'Dispositivo de Aspiración', included: true },
  { label: 'Espera de Cascada (01) unidad (plomería)', included: true },
  { label: 'Luz Led Color Azul (02) unidades', included: true },
  { label: 'Materiales eléctricos desde la piscina hasta la casa de Máquina', included: true },
  { label: 'Espera de Cascada (plomería y llave de paso en la Casa de Máquina)', included: true },
];

/** "28 dias del mes de Diciembre del 2024" — mesmo formato do modelo original da Clic Piscinas. */
function formatContractDate(isoDate: string): string {
  if (!isoDate) return '____';
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const d = new Date(`${isoDate}T00:00:00`);
  return `${d.getDate()} dias del mes de ${meses[d.getMonth()]} del ${d.getFullYear()}`;
}

/** "14 de Enero" — formato curto usado na janela de compra programada. */
function formatShortDate(isoDate: string): string {
  if (!isoDate) return '____';
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const d = new Date(`${isoDate}T00:00:00`);
  return `${d.getDate()} de ${meses[d.getMonth()]}`;
}

function formatGs(value: string): string {
  const n = Number(value.replace(/\D/g, ''));
  if (!n) return value || '0';
  return n.toLocaleString('es-PY');
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Modelo fixo do contrato de compra-venda de piscina da Clic Piscinas
 * (cláusulas B a LL nunca mudam por cliente — pedido real 15/08/2026,
 * texto extraído do modelo real que o tenant mandou). Só as partes
 * indicadas pelos campos do formulário abaixo mudam por venda. Fase 1: sem
 * IA de pré-preenchimento (isso é a Fase 2, ainda não construída) — o
 * operador preenche os campos manualmente e revisa/edita o texto final
 * antes de imprimir (a área de pré-visualização é contentEditable).
 */
export const ContractModal: React.FC<ContractModalProps> = ({ isOpen, onClose, buyerName }) => {
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [buyerCi, setBuyerCi] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [city, setCity] = useState('Asunción');
  const [contractDate, setContractDate] = useState(todayIso());
  const [poolModel, setPoolModel] = useState('COVENTINA');
  const [poolColor, setPoolColor] = useState('Azul');
  const [poolLength, setPoolLength] = useState('4.00');
  const [poolWidth, setPoolWidth] = useState('2.30');
  const [poolDepth, setPoolDepth] = useState('1.40');
  const [accessories, setAccessories] = useState<AccessoryItem[]>(DEFAULT_ACCESSORIES);
  const [installSameAsBuyer, setInstallSameAsBuyer] = useState(true);
  const [installAddress, setInstallAddress] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [totalValue, setTotalValue] = useState('');
  const [downPayment, setDownPayment] = useState('');
  const [installStartHours, setInstallStartHours] = useState('72');
  const [contractHtml, setContractHtml] = useState('');

  const resetAndClose = () => {
    setStep('form');
    onClose();
  };

  const buildContractText = (): string => {
    const totalN = Number(totalValue.replace(/\D/g, '')) || 0;
    const downN = Number(downPayment.replace(/\D/g, '')) || 0;
    const balanceN = Math.max(totalN - downN, 0);
    const balanceHalf = Math.round(balanceN / 2);
    const installLocation = installSameAsBuyer ? buyerAddress : installAddress;

    return `CONTRATO DE COMPRA-VENTA

En Ciudad ${city} a los ${formatContractDate(contractDate)}, El Sr./Sra.: ${buyerName || '____________'}, con C.I.Nº: ${buyerCi || '____________'}; con Domicilio en ${buyerAddress || '____________'}, denominado en adelante EL COMPRADOR, formaliza el presente contrato de compraventa, con ClicPiscinas (Diego Vera con C.I.Nº 3.996.645), con domicilio en Barrio Sajonia Casa de la Calle Capitán Aranda Nº1680 casi Gobernador Irala; en adelante el Vendedor; Mayores de edad, hábiles para contratar, de común acuerdo convienen en celebrar el presente CONTRATO PRIVADO DE COMPRA-VENTA DE PISCINA E INSTALACIÓN, que se regirá por las cláusulas y condiciones siguientes.

OBJETO DEL CONTRATO - Compra PROGRAMADA (para Fecha ${formatShortDate(windowStart)} al ${formatShortDate(windowEnd)})
El presente contrato tiene como finalidad formalizar la compra-venta del siguiente producto:
Piscina modelo ${poolModel}, color ${poolColor}, de ${poolLength} metros de largo x ${poolWidth} metros de ancho y Prof. ${poolDepth} m

Accesorios incluidos para la piscina:
${accessories.map((a) => `- ${a.label}: ${a.included ? 'SÍ' : 'NO'}`).join('\n')}

B – DEL LUGAR DE INSTALACIÓN
EL COMPRADOR confirma que la instalación de la piscina detallada precedentemente deberá realizarse en ${installLocation || '____________'}.

C – DEL TRASPORTE
EL VENDEDOR asume el costo de transporte de la piscina y de la caja de máquinas hasta el lugar de la instalación.

D – DEL PAGO
El valor total de la compra y servicio de instalación acordado por las partes asciende a la suma total de Gs ${formatGs(totalValue)} (Guaraníes).- En el acto se realiza la entrega de Gs. ${formatGs(downPayment)} (Guaraníes) en efectivo, cheque al día sin cruzar y/o transferencia bancaria.
El saldo pendiente de Gs. ${formatGs(String(balanceN))} (Guaraníes), será realizado de la siguiente forma: en fecha ${formatShortDate(windowStart)} hasta fin de mes ${formatShortDate(windowEnd)}, el cliente avisa que dispone del saldo pendiente y con 2 días antes el comprador confirma el inicio de las instalaciones y completa la entrega del 50% equivalente a Gs. ${formatGs(String(balanceHalf))} (Guaraníes), documentado en pagaré. El saldo restante de Gs. ${formatGs(String(balanceN - balanceHalf))} (Guaraníes) será documentado en pagaré y cancelado a la llegada de la piscina con sus accesorios, en el lugar de la instalación estipulada en la cláusula B.

E – DE LA INSTALACIÓN
El Vendedor se compromete a iniciar los trabajos de instalación en ${installStartHours}hs, a partir del cumplimiento de la Cláusula D del Pago. Para el supuesto de que exista alguna variación en el plazo establecido precedentemente, el VENDEDOR deberá notificarle tal situación al COMPRADOR.

F – ACABADO / ÁREA PERIMETRAL / PATIO / SOLARIO
Es responsabilidad del cliente:
- Remoción de tierra excavada.
- Eliminación de obstáculos (árboles, suelos, rocas, alcantarillas, redes de agua y pozos).
- Riego en camiones cisterna para llenar la piscina si no hay agua en el sitio.
- Conexión de red eléctrica hasta la ubicación del filtro/motor (casa de máquinas).
- Si el terreno no es adecuado, corresponde al cliente proporcionar el terreno correcto.
- Contrapiso alrededor de la piscina después de la finalización: máximo 3 días.

G – OBLIGACIONES DEL VENDEDOR
A.- El VENDEDOR asume el transporte del producto, en los términos establecidos en el punto C del presente.
B.- Excavación del pozo para instalación de la piscina.
C.- Asentamiento de la piscina e instalación del equipo de filtrado dentro de los patrones establecidos por la Marca.
D.- Aterramiento, compactación de la tierra en el perímetro de la piscina y equipo de filtrado con hasta cubrir la superficie de 50 cm (cincuenta centímetros) alrededor de la instalación de los productos adquiridos.
E.- Instruir al COMPRADOR sobre el uso de los equipamientos y tratamiento del agua de la piscina.

H – OBLIGACIONES DEL COMPRADOR
A.- Remoción a su costo de cualquier tipo de obstáculo (árboles, pisos, piedras, rocas, línea de desagote, fosas, red de agua, pasto, retiro de tierra y escombros).
B.- Para el supuesto que sea necesario trasladar la piscina por sobre techos, muros, cercas, toldos, cercas eléctricas, balcones, escaleras, y/o cualquier otro obstáculo; será el comprador responsable por cualquier daño que se causaren a los mismos asumiendo la reparación de los mismos. Asimismo, en el supuesto de que no exista manera de poder ingresar manualmente la piscina en el lugar donde se ha requerido la instalación, es por cuenta y orden del COMPRADOR la contratación de una grúa mecánica o maquinaria pesada.
C.- Remoción de tierra, escombro y desechos producidos por la excavación generados por la instalación del producto hasta el lugar de deposición final.
D.- Instalación eléctrica de la red desde la alimentación de energía hasta la casa de Máquinas.
E.- En el supuesto de que las características de la tierra no sea la adecuada para la instalación de la piscina, el COMPRADOR deberá proveer a su costa los materiales que se le soliciten para realizar la correcta instalación.
F.- En el supuesto que no hubiese agua, o la presión de agua sea insuficiente, el COMPRADOR debe proveer a su costa un camión cisterna para que este efectúe el llenado de la piscina.
H.- Adquirir los materiales para la instalación de la piscina, tales como cemento, ladrillos, arena, caños PVC marrón soldable, piedra, etc., manteniendo el depósito de estos materiales en una distancia máxima de hasta unos 05 (Cinco) metros del lugar de la instalación. Asimismo, debe adquirir los materiales eléctricos necesarios para la instalación del filtro Motor, tales como cables de 4mm flexibles, caño corrugado y demás elementos que sean indicados por el instalador.
M.- El COMPRADOR deberá acompañar personalmente o a través de la persona autorizada, la ejecución de los servicios diariamente a fin de evitar eventuales desacuerdos y reclamos en los servicios.
N.- El contrapiso alrededor de la piscina deberá ser iniciado en un período de 24 (veinticuatro) horas y como máximo 72 (setenta y dos) horas corridas desde que se finaliza la instalación, con una inclinación no menor a 2% (dos por ciento) por metro. En caso de que existan inclemencias del tiempo que impidan la ejecución de dicho trabajo, el comprador cubrirá el área perimetral con un material impermeable, y se suspenderá la realización del perímetro del piso, hasta que las condiciones climáticas lo permitan; en tal caso deberá requerirse la supervisión del VENDEDOR (instalador).

I – RESOLUCIÓN CONTRACTUAL/SECUESTRO
La falta de pago de cualquiera de las cuotas establecidas en este contrato producirá la caducidad automática de todos los plazos estipulados, generando el vencimiento inmediato de la totalidad de la deuda, pudiendo EL VENDEDOR promover acción ejecutiva directa, solicitando como medida cautelar, el secuestro de los bienes indicados en la cláusula primera.
De conformidad con el art. 783 del Código Civil, en caso de mora, los pagos efectuados por el comprador antes del decaimiento de los plazos, serán imputados a favor del vendedor como compensación equitativa por el uso y desgaste de los bienes; renunciando el COMPRADOR a reclamar restitución de pago alguno. El valor compensado por el uso y desgaste no impide al VENDEDOR reclamar eventual indemnización por daños a los bienes objeto del presente contrato.
EL VENDEDOR también podrá rescindir este contrato, de pleno derecho, independientemente de cualquier notificación, interpelación judicial o extrajudicial, si el COMPRADOR entra en estado de insolvencia demostrada por al menos dos incumplimientos de pago, por cualquier deuda que tenga contraída fuera de este instrumento.
EL VENDEDOR también podrá rescindir del contrato en el caso de que antes o durante la instalación de los productos, los instaladores consideren que el lugar no sea apto para la instalación por las características o condiciones de lugar/suelo, debiendo abonar el COMPRADOR los gastos realizados.

J – GARANTÍA DEL PRODUCTO
Tanto la piscina como los productos detallados, una vez instalados y en correcto funcionamiento en el domicilio señalado, serán considerados como aceptados de conformidad en forma tácita por el usuario si no son objetados dentro de los 15 días de uso a partir de la recepción, no teniendo más nada que reclamar a la vendedora en ningún concepto relacionado a la instalación y el buen funcionamiento de los productos individualizados.
El desagote (vaciamiento) total de la piscina, sin la presencia de un técnico autorizado por el VENDEDOR, producirá la pérdida de la garantía del casco (fibra) durante el período de 1 año.
La parte estructural de la piscina (casco) cuenta con una garantía de Un (1) año ante cualquier defecto de fábrica. La Instalación cuenta con una garantía de Cinco (05) años. Equipo de filtración y casa de máquinas: 6 meses. Electrobomba: 6 meses. Componentes eléctricos: seis (6) meses, todos por algún defecto de fábrica (no incluye garantía por daños por mal uso, o variaciones eléctricas).
EXCLUYEN DE LA GARANTÍA DAÑOS CAUSADOS POR: mal uso del motor o descargas eléctricas; luz LED por descargas eléctricas o humedad por dejar destapada la casa de máquinas; la intemperie climática y/o movimientos sísmicos y/o inclemencias naturales; daños por compactación al realizar el contrapiso; ruptura de dispositivo hidráulico o caños PVC; daños provocados por muros y vertederos que vayan a ceder; daños causados por el crecimiento de raíces de flora; daños causados por objetos que caigan y dañen la piscina; daños causados por movimiento de terreno o inundaciones; daños causados por rompimiento de tubería; daños provocados por aparición de capa freática no evidente al momento de la instalación; daños causados por el mal uso de productos químicos y naturales; uso inadecuado o excesivo de productos químicos, materiales de limpieza y abrasivos; decoloración natural causada por rayos UV; por altas temperaturas del agua y/o uso de coberturas de protección tipo lonas por largos períodos y/o uso de calefactores defectuosos; blanqueamiento o erupciones (burbujas) del gel coat debajo del nivel del agua provocado por excesos de producción de químicos; manchas causadas por productos químicos a base de sulfato de cobre y/o sus derivados; daño causado por el uso del clorador flotante; daños causados por sustancias agresivas encontradas en el suelo (cal, agrotóxicos, etc.).

K – SERVICIO TÉCNICO
Cuando la reparación del producto sea por su mal uso, el CONSUMIDOR deberá abonar la visita técnica y el arreglo del mismo, conforme el precio cotizado por el VENDEDOR.

L – NULIDAD
Con relación a lo dispuesto por el artículo 365 del Código Civil, si alguna de las cláusulas o condiciones de este contrato fuere total o parcialmente nula, tal nulidad afectará únicamente y exclusivamente a dicha disposición o cláusula. En todo lo demás, este contrato seguirá válido y vinculante.

LL – DE LA JURISDICCIÓN
Las partes contratantes, de común acuerdo, eligen como competente la jurisdicción del Dpto. de Central, para dirimir cualquier duda oriunda del presente contrato, con exclusión de cualquier otro por más privilegiado que sea.

BAJO TALES CLÁUSULAS Y CONDICIONES queda formalizado el presente contrato, a cuyo fiel cumplimiento se obligan las partes conforme y con arreglo a derecho, firmando en prueba de conformidad en dos ejemplares de un mismo tenor y a un solo efecto, en el mismo lugar y fecha de su otorgamiento.


______________________________                    ______________________________
GERENTE COMERCIAL                                  COMPRADOR (cliente)`;
  };

  const handleGenerate = () => {
    setContractHtml(buildContractText());
    setStep('preview');
  };

  const handlePrint = () => {
    window.print();
  };

  const updateAccessory = (index: number, included: boolean) => {
    setAccessories((prev) => prev.map((a, i) => (i === index ? { ...a, included } : a)));
  };

  if (!isOpen) return null;

  return (
    <div className="contract-print-root fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:bg-white print:backdrop-blur-none print:p-0">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl max-h-[90vh] flex flex-col print:bg-white print:border-0 print:rounded-none print:max-w-none print:max-h-none">
        <div className="flex items-center justify-between p-5 border-b border-slate-800 print:hidden">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            {step === 'form' ? 'Gerar Contrato' : 'Revisar Contrato'}
          </h3>
          <button onClick={resetAndClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 'form' ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
            <p className="text-xs text-slate-400">
              Modelo do contrato de compra-venda de piscina da Clic Piscinas. Preencha o que já foi combinado — o texto final fica editável antes de imprimir.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-300 block mb-1">Nome do comprador</label>
                <input type="text" value={buyerName} readOnly className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">C.I. do comprador</label>
                <input type="text" value={buyerCi} onChange={(e) => setBuyerCi(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">Cidade</label>
                <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-300 block mb-1">Endereço do comprador</label>
                <input type="text" value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">Data do contrato</label>
                <input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3">
              <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wide mb-2">Produto</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Modelo</label>
                  <input type="text" value={poolModel} onChange={(e) => setPoolModel(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Cor</label>
                  <input type="text" value={poolColor} onChange={(e) => setPoolColor(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Comprimento (m)</label>
                  <input type="text" value={poolLength} onChange={(e) => setPoolLength(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Largura (m)</label>
                  <input type="text" value={poolWidth} onChange={(e) => setPoolWidth(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Profundidade (m)</label>
                  <input type="text" value={poolDepth} onChange={(e) => setPoolDepth(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3">
              <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wide mb-2">Acessórios incluídos</h4>
              <div className="space-y-1.5">
                {accessories.map((acc, i) => (
                  <label key={acc.label} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={acc.included} onChange={(e) => updateAccessory(i, e.target.checked)} className="cursor-pointer" />
                    <span>{acc.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3">
              <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wide mb-2">Instalação</h4>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer mb-2">
                <input type="checkbox" checked={installSameAsBuyer} onChange={(e) => setInstallSameAsBuyer(e.target.checked)} className="cursor-pointer" />
                <span>Mesmo endereço do comprador</span>
              </label>
              {!installSameAsBuyer && (
                <input type="text" value={installAddress} onChange={(e) => setInstallAddress(e.target.value)} placeholder="Endereço de instalação" className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none mb-2" />
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Janela de compra — início</label>
                  <input type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Janela de compra — fim</label>
                  <input type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Início da instalação (horas após pago)</label>
                  <input type="text" value={installStartHours} onChange={(e) => setInstallStartHours(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3">
              <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wide mb-2">Pagamento (Gs)</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Valor total</label>
                  <input type="text" value={totalValue} onChange={(e) => setTotalValue(e.target.value)} placeholder="Ex: 18500000" className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Entrada</label>
                  <input type="text" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} placeholder="Ex: 500000" className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none" />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              className="w-full mt-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              Gerar Contrato
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 print:p-0 print:overflow-visible">
              <div
                contentEditable
                suppressContentEditableWarning
                className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed print:text-black print:text-[11px] focus:outline-none"
              >
                {contractHtml}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 p-4 border-t border-slate-800 print:hidden">
              <button
                type="button"
                onClick={() => setStep('form')}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Voltar e editar campos
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                Imprimir
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
