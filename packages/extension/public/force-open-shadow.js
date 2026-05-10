// Hook injected at document_start in MAIN world for domains listed in
// any skill's metadata.force_open_shadow. Forces mode:'open' so the
// extension can pierce shadow DOM with composedPath/recursive query.
//
// Camouflage: preserve attachShadow.toString output to avoid trivial
// detection (e.g., sites checking native code).
(() => {
  const W = /** @type {{__aaaShadowHooked?: boolean}} */ (window);
  if (W.__aaaShadowHooked) return;
  W.__aaaShadowHooked = true;
  const original = Element.prototype.attachShadow;
  const originalToString = Function.prototype.toString.call(original);
  function patched(init) {
    return original.call(this, { ...init, mode: 'open' });
  }
  Element.prototype.attachShadow = patched;
  // make patched.toString() return the original native code string
  patched.toString = () => originalToString;
  // Same for Function.prototype.toString.call(patched)
  const fnProtoToString = Function.prototype.toString;
  Function.prototype.toString = function () {
    if (this === patched) return originalToString;
    return fnProtoToString.call(this);
  };
})();
