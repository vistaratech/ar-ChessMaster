import React, { Component, ErrorInfo, ReactNode } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleResetStorage = async () => {
    try {
      await AsyncStorage.clear();
      this.setState({ hasError: false, error: null, errorInfo: null });
    } catch {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  };

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || 'Unknown runtime error';
      const stack = this.state.error?.stack || this.state.errorInfo?.componentStack || '';

      return (
        <SafeAreaView style={styles.root}>
          <View style={styles.container}>
            <View style={styles.iconCircle}>
              <Text style={styles.icon}>⚠️</Text>
            </View>

            <Text style={styles.title}>App-ல் பிரச்சனை ஏற்பட்டது</Text>
            <Text style={styles.subtitle}>
              ஆப் க்ராஷ் ஆகாமல் தடுத்துள்ளோம். கீழே உள்ள விவரங்களை சரிபார்க்கவும்.
            </Text>

            <View style={styles.errorBox}>
              <ScrollView style={styles.scroll}>
                <Text style={styles.errorMsgText}>{msg}</Text>
                {!!stack && <Text style={styles.stackText}>{stack}</Text>}
              </ScrollView>
            </View>

            <View style={styles.btnRow}>
              <Pressable style={styles.primaryBtn} onPress={this.handleRestart}>
                <Text style={styles.primaryBtnText}>🔄 மீண்டும் முயற்சி (Restart)</Text>
              </Pressable>

              <Pressable style={styles.secondaryBtn} onPress={this.handleResetStorage}>
                <Text style={styles.secondaryBtnText}>🗑️ Reset Cache & Data</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0d12',
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  icon: {
    fontSize: 28,
  },
  title: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  errorBox: {
    width: '100%',
    maxHeight: 220,
    backgroundColor: '#131b26',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    marginBottom: 24,
  },
  scroll: {
    flexGrow: 0,
  },
  errorMsgText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  stackText: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  btnRow: {
    width: '100%',
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: '#1e293b',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
  },
  secondaryBtnText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
});
