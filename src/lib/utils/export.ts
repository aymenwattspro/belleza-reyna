import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { InventoryItem, PurchaseOrderSummary } from '../types/inventory';

// Extend jsPDF with autotable
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

export const exportToExcel = (data: InventoryItem[], fileName: string) => {
  const exportData = data
    .filter(item => (item.pedido || 0) > 0)
    .map(item => ({
      'Clave': item.clave,
      'Proveedor': item.proveedor || '',
      'Descripción': item.descripcion,
      'Existencia': item.existencia,
      'Precio C.': item.precioC,
      'Pedido': item.pedido,
      'Valor Pedido': item.valorPedido,
    }));

  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pedido');
  XLSX.writeFile(wb, `${fileName}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
};

export const exportInventoryToExcel = (data: InventoryItem[], fileName: string) => {
  const exportData = data.map(item => ({
    'Clave': item.clave,
    'Proveedor': item.proveedor || '',
    'Descripción': item.descripcion,
    'Existencia': item.existencia,
    'Precio C.': item.precioC,
    'Stock Objetivo': item.stockObjetivo || 0,
    'Empaque (Piezas)': item.piezas || 1,
  }));

  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  XLSX.writeFile(wb, `${fileName}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
};

export const exportDashboardSummary = (data: InventoryItem[]) => {
  const lowStock = data.filter(item => item.existencia < (item.stockObjetivo || 10));
  
  const summaryData = [
    { 'Métrica': 'Total Productos', 'Valor': data.length },
    { 'Métrica': 'Bajo Stock', 'Valor': lowStock.length },
    { 'Métrica': 'Valor Total Inventario', 'Valor': data.reduce((acc, item) => acc + (item.existencia * item.precioC), 0) },
    { 'Métrica': 'Fecha de Reporte', 'Valor': format(new Date(), 'dd/MM/yyyy HH:mm') },
  ];

  const wsSummary = XLSX.utils.json_to_sheet(summaryData);
  const wsDetails = XLSX.utils.json_to_sheet(lowStock.map(item => ({
    'Clave': item.clave,
    'Proveedor': item.proveedor || '',
    'Descripción': item.descripcion,
    'Existencia': item.existencia,
    'Stock Objetivo': item.stockObjetivo || 0,
    'Faltante': Math.max(0, (item.stockObjetivo || 0) - item.existencia)
  })));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');
  XLSX.utils.book_append_sheet(wb, wsDetails, 'Detalles Bajo Stock');
  XLSX.writeFile(wb, `Resumen_Dashboard_Reyna_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
};

export const exportToPDF = (
  data: InventoryItem[], 
  summary: PurchaseOrderSummary,
  userName: string = 'Monica Espinosa'
) => {
  const doc = new jsPDF();
  const pink = [231, 84, 128]; // #E75480

  // Branding
  doc.setFontSize(22);
  doc.setTextColor(pink[0], pink[1], pink[2]);
  doc.text('Productos de Belleza Reyna', 105, 20, { align: 'center' });

  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`Fecha: ${format(new Date(), 'dd/MM/yyyy')}`, 20, 35);
  doc.text(`Proveedor: ${summary.supplierName}`, 20, 40);
  doc.text(`Pedido a nombre de: ${userName}`, 20, 45);

  // Table
  const tableData = data
    .filter(item => (item.pedido || 0) > 0)
    .map(item => [
      item.clave,
      item.descripcion,
      item.existencia,
      `$${item.precioC.toFixed(2)}`,
      item.pedido,
      `$${(item.valorPedido || 0).toFixed(2)}`
    ]);

  doc.autoTable({
    startY: 55,
    head: [['Clave', 'Descripción', 'Exist.', 'Precio', 'Pedido', 'Total']],
    body: tableData,
    headStyles: { fillColor: pink, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 215, 232] }, // Soft pink
    margin: { top: 55 },
    styles: { fontSize: 9, cellPadding: 3 },
  });

  // Total
  const finalY = (doc as any).lastAutoTable.finalY || 150;
  doc.setFontSize(12);
  doc.setTextColor(pink[0], pink[1], pink[2]);
  doc.text(`TOTAL PEDIDO: $${summary.totalValue.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, 190, finalY + 15, { align: 'right' });

  doc.save(`Pedido_Reyna_${summary.supplierName}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
};
