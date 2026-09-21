(function (root) {
  'use strict';

  var messages = {
    NO_CONSUMER_ACCESS: {
      title: '服务尚未开通',
      description: '当前账号尚未开通 A380 服务，请联系管理员开通后重试。',
      retryable: false,
    },
    CONTEXT_SELECTION_REQUIRED: {
      title: '需要选择门店',
      description: '当前账号可访问多个经营门店，请从 IM 重新进入并选择门店。',
      retryable: false,
    },
    IAM_CONTEXT_UNAVAILABLE: {
      title: '服务暂时不可用',
      description: '授权服务正在恢复，请稍后点击重试。',
      retryable: true,
    },
    SAAS_SESSION_REQUIRED: {
      title: '登录状态已过期',
      description: '当前登录状态已失效，请重新从 IM 进入 A380。',
      retryable: true,
    },
    IM_SESSION_EXPIRED: {
      title: 'IM 登录已失效',
      description: '请返回 IM 重新登录后，再进入 A380。',
      retryable: false,
    },
    IM_BRIDGE_AUTH_FAILED: {
      title: '无法完成 IM 授权',
      description: '请返回 IM 后重新进入 A380；如持续失败请更新 IM App。',
      retryable: false,
    },
    PKCE_UNAVAILABLE: {
      title: '当前环境不支持授权',
      description: '请从已更新的 IM App 重新进入 A380，或使用 HTTPS 地址访问。',
      retryable: false,
    },
  };

  root.A380AuthErrors = {
    describe: function (error) {
      var code = error && error.code;
      if (code && messages[code]) return messages[code];
      if (error && Number(error.status) >= 500) return messages.IAM_CONTEXT_UNAVAILABLE;
      return {
        title: '暂时无法进入服务',
        description: '网络或授权服务异常，请稍后重试；如持续失败请联系管理员。',
        retryable: true,
      };
    },
  };
})(window);
