(function (root) {
  root.A380Context = {
    chooseSingle: function (items) {
      var list = Array.isArray(items) ? items : (items && items.items) || [];
      return list.length === 1 ? list[0] : null;
    }
  };
})(window);
