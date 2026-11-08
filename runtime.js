/* Tiny standalone runtime for the portfolio page.
   Renders the <template id="tpl"> with {{holes}}, <sc-for>, <sc-if>,
   event bindings (onClick="{{fn}}") and ref callbacks, driven by the
   page's Component class (renderVals + setState). */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; this._schedule = null; }
    setState(upd) {
      const patch = typeof upd === 'function' ? upd(this.state, this.props) : upd;
      this.state = Object.assign({}, this.state, patch);
      if (this._schedule) this._schedule();
    }
    forceUpdate() { if (this._schedule) this._schedule(); }
  }
  window.DCLogic = DCLogic;

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const SINGLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  const EVENTS = { onclick: 'click', onmousemove: 'mousemove', onmouseleave: 'mouseleave', onmouseenter: 'mouseenter', onfocus: 'focus', onblur: 'blur' };

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    let v = scope;
    for (const k of path.split('.')) { if (v == null) return undefined; v = v[k]; }
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, (_, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); });
  }
  const sig = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));

  // renders template children into parent (before `before`), returns bindings
  function renderChildren(tplParent, scope, parent, before, refs) {
    const binds = [];
    for (const n of Array.from(tplParent.childNodes)) renderNode(n, scope, parent, before, binds, refs);
    return binds;
  }

  function renderNode(n, scope, parent, before, binds, refs) {
    if (n.nodeType === 3) {
      const t = document.createTextNode(n.nodeValue.indexOf('{{') >= 0 ? interp(n.nodeValue, scope) : n.nodeValue);
      parent.insertBefore(t, before);
      if (n.nodeValue.indexOf('{{') >= 0) binds.push({ k: 'text', node: t, tpl: n.nodeValue, scope });
      return;
    }
    if (n.nodeType !== 1) return;
    const tag = n.localName;
    if (tag === 'sc-for' || tag === 'sc-if') {
      const anchor = document.createComment(tag);
      parent.insertBefore(anchor, before);
      const region = { k: tag, tpl: n, scope, anchor, nodes: [], binds: [], refs: [], sig: null, scopes: [] };
      buildRegion(region);
      binds.push(region);
      return;
    }
    const el = n.cloneNode(false);
    const evs = [];
    let refFn = null;
    for (const a of Array.from(n.attributes)) {
      const name = a.name, val = a.value;
      if (name.indexOf('hint-') === 0) { el.removeAttribute(name); continue; }
      const lname = name.toLowerCase();
      if (EVENTS[lname]) {
        el.removeAttribute(name);
        const m = val.match(SINGLE);
        if (m) {
          const path = m[1];
          const holder = { scope };
          el.addEventListener(EVENTS[lname], (e) => { const f = lookup(path, holder.scope); if (typeof f === 'function') f(e); });
          evs.push(holder);
        }
        continue;
      }
      if (lname === 'ref') {
        el.removeAttribute(name);
        const m = val.match(SINGLE);
        if (m) refFn = lookup(m[1], scope);
        continue;
      }
      if (val.indexOf('{{') >= 0) {
        el.setAttribute(name, interp(val, scope));
        binds.push({ k: 'attr', el, name, tpl: val, scope });
      }
    }
    if (evs.length) binds.push({ k: 'ev', holders: evs });
    parent.insertBefore(el, before);
    // template content of <template> elements is not walked (none used)
    const kids = renderChildren(n, scope, el, null, refs);
    for (const b of kids) binds.push(b);
    if (typeof refFn === 'function') { refFn(el); refs.push(refFn); }
  }

  function regionValue(region) {
    const t = region.tpl;
    if (region.k === 'sc-if') return !!lookup((t.getAttribute('value') || '').replace(/[{}]/g, ''), region.scope);
    const v = lookup((t.getAttribute('list') || '').replace(/[{}]/g, ''), region.scope);
    return Array.isArray(v) ? v : [];
  }

  function clearRegion(region) {
    region.refs.forEach((f) => { try { f(null); } catch (e) {} });
    region.nodes.forEach((nd) => nd.parentNode && nd.parentNode.removeChild(nd));
    region.nodes = []; region.binds = []; region.refs = []; region.scopes = [];
  }

  function buildRegion(region) {
    clearRegion(region);
    const val = regionValue(region);
    region.sig = sig(val);
    const parent = region.anchor.parentNode;
    const frag = document.createDocumentFragment();
    if (region.k === 'sc-if') {
      if (val) region.binds = renderChildren(region.tpl, region.scope, frag, null, region.refs);
    } else {
      const as = region.tpl.getAttribute('as') || 'item';
      val.forEach((item, i) => {
        const sc = Object.create(region.scope);
        sc[as] = item; sc.$index = i;
        region.scopes.push(sc);
        const bs = renderChildren(region.tpl, sc, frag, null, region.refs);
        region.binds.push.apply(region.binds, bs);
      });
    }
    region.nodes = Array.from(frag.childNodes);
    parent.insertBefore(frag, region.anchor.nextSibling);
  }

  function update(binds) {
    for (const b of binds) {
      if (b.k === 'text') { const v = interp(b.tpl, b.scope); if (b.node.nodeValue !== v) b.node.nodeValue = v; }
      else if (b.k === 'attr') { const v = interp(b.tpl, b.scope); if (b.el.getAttribute(b.name) !== v) b.el.setAttribute(b.name, v); }
      else if (b.k === 'sc-for' || b.k === 'sc-if') {
        const val = regionValue(b);
        const s = sig(val);
        if (s !== b.sig) { buildRegion(b); continue; }
        if (b.k === 'sc-for') {
          const as = b.tpl.getAttribute('as') || 'item';
          b.scopes.forEach((sc, i) => { sc[as] = val[i]; });
        }
        update(b.binds);
      }
    }
  }

  function boot() {
    const tpl = document.getElementById('tpl');
    const mount = document.getElementById('app');
    const props = {};
    const defs = JSON.parse(document.getElementById('props').textContent);
    Object.keys(defs).forEach((k) => { if (k[0] !== '$' && 'default' in defs[k]) props[k] = defs[k].default; });
    const comp = new window.Component(props);
    const root = {};
    Object.assign(root, comp.renderVals());
    const refs = [];
    const binds = renderChildren(tpl.content, root, mount, null, refs);
    let queued = false;
    comp._schedule = () => {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => {
        queued = false;
        Object.assign(root, comp.renderVals());
        update(binds);
      });
    };
    if (comp.componentDidMount) comp.componentDidMount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
