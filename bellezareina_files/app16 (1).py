# -*- coding: utf-8 -*-
import streamlit as st
import pandas as pd
import numpy as np
import pdfplumber
import os

st.set_page_config(page_title="Sistema de Inventario", layout="wide")

st.title("💄 Productos de Belleza Reyna - Sistema de Inventario")

# PDF PRO
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from datetime import datetime
from io import BytesIO

# ---------------------------
# CONFIGURACIÓN PROVEEDORES
# ---------------------------
minimos_proveedores = {
    "proveedor_a": 1000,
    "proveedor_b": 2000,
    "proveedor_c": 1500
}

# ---------------------------
# LIMPIAR CSV
# ---------------------------
def limpiar_csv(file):
    df = pd.read_csv(file, encoding='latin1')

    # Usar fila correcta como encabezado
    df.columns = df.iloc[2]
    df = df.iloc[3:].reset_index(drop=True)

    # Normalizar nombres de columnas
    df.columns = df.columns.astype(str).str.strip().str.lower()

    columnas_map = {}

    for col in df.columns:
        if "clave" in col:
            columnas_map['Clave'] = col
        elif "descrip" in col:
            columnas_map['Descripción'] = col
        elif "precio c" in col or "costo" in col:
            columnas_map['Precio C.'] = col

        elif "exist" in col:
            columnas_map['Existencia'] = col

    if len(columnas_map) < 4:
        st.error(f"⚠️ Columnas detectadas: {df.columns.tolist()}")
        st.stop()

    df = df[list(columnas_map.values())]
    df.columns = list(columnas_map.keys())

    # ---------------------------
    # LIMPIEZA FUERTE 🔥
    # ---------------------------

    # Quitar espacios vacíos
    df.replace(r'^\s*$', np.nan, regex=True, inplace=True)

    # Eliminar columnas completamente vacías
    df.dropna(axis=1, how='all', inplace=True)

    # Eliminar filas completamente vacías
    df.dropna(how='all', inplace=True)

    # Eliminar filas basura (texto tipo páginas, reportes, etc.)
    df = df[~df['Clave'].astype(str).str.contains('Página|Reporte|Departamento|Grupo|Categoría', case=False, na=False)]

    # Convertir tipos
    df['Existencia'] = pd.to_numeric(df['Existencia'], errors='coerce')

    df['Precio C.'] = df['Precio C.'].replace('[\$,]', '', regex=True)
    df['Precio C.'] = pd.to_numeric(df['Precio C.'], errors='coerce')

    # Eliminar cualquier fila con NA después de conversiones
    df.dropna(inplace=True)

    # Reset index final limpio
    df = df.reset_index(drop=True)

    return df

# ---------------------------
# LEER EXCEL (STOCK OBJETIVO)
# ---------------------------
def leer_excel(file):
    df = pd.read_excel(file)

    # Normalizar columnas
    df.columns = df.columns.astype(str).str.strip().str.lower()

    columnas_map = {}

    for col in df.columns:
        if "clave" in col:
            columnas_map['Clave'] = col
        elif "descrip" in col:
            columnas_map['Descripción'] = col
        elif "exist" in col or "stock" in col:
            columnas_map['Stock_objetivo'] = col
        elif "pieza" in col or "pz" in col:
            columnas_map['Piezas'] = col

    if len(columnas_map) < 4:
        st.error(f"⚠️ Columnas detectadas en Excel: {df.columns.tolist()}")
        st.stop()

    df = df[list(columnas_map.values())]
    df.columns = list(columnas_map.keys())

    df['Stock_objetivo'] = pd.to_numeric(df['Stock_objetivo'], errors='coerce')

    df.dropna(inplace=True)

    return df

# ---------------------------
# PDF PRO
# ---------------------------
def generar_pdf(df, proveedor, total, logo_path=None):
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    elements = []
    styles = getSampleStyleSheet()

    # Logo
    if logo_path:
        try:
            logo = Image(logo_path, width=100, height=50)
            elements.append(logo)
            elements.append(Spacer(1, 10))
        except:
            pass

    # Título marca
    elements.append(Paragraph("PRODUCTOS DE BELLEZA REYNA", styles['Title']))
    elements.append(Paragraph("Orden de Compra", styles['Heading2']))
    elements.append(Spacer(1, 10))

    # Info
    fecha = datetime.now().strftime("%d/%m/%Y")

    elements.append(Paragraph(f"<b>Proveedor:</b> {proveedor}", styles['Normal']))
    elements.append(Paragraph(f"<b>Fecha:</b> {fecha}", styles['Normal']))
    elements.append(Paragraph(f"<b>Pedido a nombre de:</b> Monica Espinosa", styles['Normal']))
    elements.append(Spacer(1, 15))

    # Tabla
    data = [df.columns.tolist()] + df.values.tolist()

    table = Table(data, repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.black),
        ('TEXTCOLOR',(0,0),(-1,0),colors.white),
        ('ALIGN',(0,0),(-1,-1),'CENTER'),
        ('FONTNAME', (0,0),(-1,0), 'Helvetica-Bold'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
        ('BACKGROUND', (0,1), (-1,-1), colors.whitesmoke),
    ]))

    elements.append(table)
    elements.append(Spacer(1, 20))

    # Total
    elements.append(Paragraph(f"<b>Total del pedido: ${total:,.2f}</b>", styles['Heading2']))

    doc.build(elements)
    buffer.seek(0)
    return buffer

# ---------------------------
# UPLOADS
# ---------------------------
csv_file = st.file_uploader("Sube tu CSV de inventario", type=["csv"])
excel_file = st.file_uploader("📊 Sube archivo de stock objetivo (Excel)", type=["xlsx"])

# ---------------------------
# PROCESAMIENTO
# ---------------------------
if csv_file and excel_file:

    archivo_nombre = csv_file.name.lower()
    proveedor_detectado = "Desconocido"
    minimo_compra = 0

    for proveedor, minimo in minimos_proveedores.items():
        if proveedor in archivo_nombre:
            proveedor_detectado = proveedor
            minimo_compra = minimo
            break

    st.write(f"🏢 Proveedor: {proveedor_detectado}")
    st.write(f"💰 Mínimo: ${minimo_compra:,.2f}")

    df_csv = limpiar_csv(csv_file)
    df_excel = leer_excel(excel_file)

    df_csv["Clave"] = df_csv["Clave"].astype(str).str.strip()
    df_excel["Clave"] = df_excel["Clave"].astype(str).str.strip()

    df_final = pd.merge(df_csv, df_excel, on="Clave", how="left")

    # ---------------------------
    # LIMPIAR DESCRIPCIONES
    # ---------------------------

    if 'Descripción_x' in df_final.columns:
        df_final['Descripción'] = df_final['Descripción_x']

        cols_to_drop = [col for col in ['Descripción_x', 'Descripción_y'] if col in df_final.columns]
        df_final.drop(columns=cols_to_drop, inplace=True)
    # ---------------------------
    # ORDENAR POR DESCRIPCIÓN
    # ---------------------------

    df_final = df_final.sort_values(by='Descripción', key=lambda col: col.str.lower())


    # ---------------------------
    # CREAR PEDIDO BASE
    # ---------------------------

    df_final['Pedido'] = np.where(
        df_final['Stock_objetivo'].notna(),
        np.maximum(df_final['Stock_objetivo'] - df_final['Existencia'], 0),
        0
    )

    # Guardar base (para no romper lógica)
    df_final["Pedido_base"] = df_final["Pedido"]

    # ---------------------------
    # AJUSTE POR PIEZAS (REDONDEO PROVEEDOR)
    # ---------------------------

    # Validar que exista la columna
    if "Piezas" not in df_final.columns:
        st.error("❌ No se encontró la columna 'Piezas'")
        st.write("Columnas detectadas:", df_final.columns.tolist())
        st.stop()

    df_final["Piezas"] = pd.to_numeric(df_final["Piezas"], errors="coerce")

    def ajustar_pedido(pedido, piezas):
        if pd.isna(pedido) or pd.isna(piezas) or piezas <= 0:
            return 0

        # si es menor al 50% → no pedir
        if pedido < (piezas / 2):
            return 0

        multiplo_abajo = (pedido // piezas) * piezas
        multiplo_arriba = multiplo_abajo + piezas

        # elegir el más cercano
        if (pedido - multiplo_abajo) < (multiplo_arriba - pedido):
            return int(multiplo_abajo)
        else:
            return int(multiplo_arriba)


    df_final["Pedido"] = df_final.apply(
        lambda row: ajustar_pedido(row["Pedido_base"], row["Piezas"]),
        axis=1
    )

    # ---------------------------
    # VALOR DEL PEDIDO
    # ---------------------------

    df_final['Valor_pedido'] = df_final['Pedido'] * df_final['Precio C.']
    df_final['Valor_pedido'] = df_final['Valor_pedido'].fillna(0)

    # ---------------------------
    # TABLAS Y DASHBOARD
    # ---------------------------

    pedidos = df_final[df_final['Pedido'] > 0]
    total = pedidos['Valor_pedido'].sum()
    pedidos = pedidos.sort_values(by='Descripción', key=lambda col: col.str.lower())

    tab1, tab2, tab3 = st.tabs(["📊 Inventario", "🚚 Pedidos", "💵 Resumen"])

    with tab1:
      st.dataframe(df_final)

    with tab2:
      st.dataframe(pedidos)

    with tab3:
      st.subheader("💵 Resumen del pedido")

      col1, col2, col3 = st.columns(3)

      col1.metric("Total productos", len(df_final))
      col2.metric("Productos a pedir", len(pedidos))
      col3.metric("Valor total", f"${total:,.2f}")


    # ---------------------------
    # DESCARGA EXCEL
    # ---------------------------

    def generar_excel(df):
        output = BytesIO()

        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Pedido')

        processed_data = output.getvalue()
        return processed_data


    # Solo columnas que quieres en el pedido
    # 🔍 Ver columnas reales


    # 🔧 Detectar automáticamente la columna de descripción
    col_descripcion = None

    for col in pedidos.columns:
      if "descrip" in col.lower():
        col_descripcion = col

    # 🚨 Si no la encuentra, parar
    if col_descripcion is None:
      st.error("No se encontró columna de descripción")
      st.stop()

    # 📦 Crear pedido final sin errores
    pedido_final = pedidos[['Clave', col_descripcion, 'Existencia', 'Precio C.', 'Pedido', 'Valor_pedido']]

    # 🧼 Renombrar bonito
    pedido_final.columns = ['Clave', 'Descripción', 'Existencia', 'Precio C.', 'Pedido', 'Valor_pedido']

    ### GRAFICOS###

    st.divider()
    st.header("📊 Análisis de historial")

    archivo = os.path.join(os.getcwd(), "historial", "historial_pedidos.csv")

    if os.path.exists(archivo):

        historial = pd.read_csv(archivo)

        st.subheader("📄 Historial completo")
        st.dataframe(historial)

        # ---------------------------
        # TOP PRODUCTOS
        # ---------------------------
        top_productos = (
            historial.groupby("Descripción")["Pedido"]
            .sum()
            .sort_values(ascending=False)
            .head(10)
        )

        st.subheader("🔥 Top 10 productos más pedidos")
        st.bar_chart(top_productos)

        # ---------------------------
        # MENOS VENDIDOS
        # ---------------------------
        menos_productos = (
            historial.groupby("Descripción")["Pedido"]
            .sum()
            .sort_values()
            .head(10)
        )

        st.subheader("⚠️ Productos menos pedidos")
        st.bar_chart(menos_productos)

        # ---------------------------
        # PRODUCTOS DE BAJA ROTACIÓN
        # ---------------------------
        baja_rotacion = historial.groupby("Descripción")["Pedido"].sum()
        baja_rotacion = baja_rotacion[baja_rotacion < 5]

        st.subheader("🪦 Productos de baja rotación")
        st.dataframe(baja_rotacion)

    else:
        st.info("Aún no hay historial guardado")

    # ---------------------------
    # GUARDAR HISTORIAL
    # ---------------------------
    def guardar_historial(pedido_df):
        carpeta = "C:\Users\aymen\OneDrive\Desktop\reina\historical_files"
        archivo = os.path.join(carpeta, "historial_pedidos.csv")

        # Crear carpeta si no existe
        if not os.path.exists(carpeta):
            os.makedirs(carpeta)

        pedido_df["Fecha"] = datetime.now().strftime("%Y-%m-%d")

        if os.path.exists(archivo):
            historial = pd.read_csv(archivo)
            historial = pd.concat([historial, pedido_df], ignore_index=True)
        else:
            historial = pedido_df

        historial.to_csv(archivo, index=False)
    # ---------------------------
    # GENERAR PDF
    # ---------------------------

    pdf_file = generar_pdf(pedido_final, proveedor_detectado, total)

    st.download_button(
        label="📄 Descargar pedido en PDF",
        data=pdf_file,
        file_name="pedido.pdf",
        mime="application/pdf"
    )

    excel_file = generar_excel(pedido_final)

    st.download_button(
        label="📥 Descargar pedido en Excel",
        data=excel_file,
        file_name="pedido.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    )
    if st.button("💾 Guardar pedido en historial"):
      guardar_historial(pedido_final)
      st.success("Pedido guardado en historial ✅")

# ---------------------------
# HISTORIAL Y DASHBOARD
# ---------------------------

if os.path.exists("historial_pedidos.csv"):

    historial = pd.read_csv("historial_pedidos.csv")

    st.subheader("📊 Historial de pedidos")
    st.dataframe(historial)

    # TOP PRODUCTOS
    top_productos = historial.groupby("Descripción")["Pedido"].sum().sort_values(ascending=False).head(10)

    st.subheader("🔥 Productos más pedidos")
    st.bar_chart(top_productos)

    # MENOS PEDIDOS
    menos_productos = historial.groupby("Descripción")["Pedido"].sum().sort_values().head(10)

    st.subheader("⚠️ Productos menos pedidos")
    st.bar_chart(menos_productos)

    # PRODUCTOS MUERTOS
    productos_muertos = historial.groupby("Descripción")["Pedido"].sum()
    productos_muertos = productos_muertos[productos_muertos < 5]

    st.subheader("🪦 Baja rotación")
    st.dataframe(productos_muertos)